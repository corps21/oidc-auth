import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { eq } from "drizzle-orm";
import JWT from "jsonwebtoken";
import jose from "node-jose";
import { db } from "./db";
import { clientsTable, shortCodeTable, usersTable } from "./db/schema";
import { PRIVATE_KEY, PUBLIC_KEY } from "./utils/cert";
import type { JWTClaims } from "./utils/user-token";

const app = express();
const PORT = process.env.PORT ?? 8000;

app.use(express.json());
app.use(express.static(path.resolve("public")));

app.get("/", (req, res) => res.json({ message: "Hello from Auth Server" }));

app.get("/health", (req, res) =>
  res.json({ message: "Server is healthy", healthy: true }),
);
// OIDC Endpoints
app.get("/.well-known/openid-configuration", (req, res) => {
  const ISSUER = `http://localhost:${PORT}`;
  return res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/o/authenticate`,
    userinfo_endpoint: `${ISSUER}/o/userinfo`,
    token_endpoint: `${ISSUER}/o/token`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  });
});

app.get("/.well-known/jwks.json", async (_, res) => {
  const key = await jose.JWK.asKey(PUBLIC_KEY, "pem");
  return res.json({ keys: [key.toJSON()] });
});

app.get("/o/authenticate", (req, res) => {
  return res.sendFile(path.resolve("public", "authenticate.html"));
});

app.get("/o/client", (req, res) => {
  return res.sendFile(path.resolve("public", "client.html"));
});

app.post("/o/client", async (req, res) => {
  const {appName, redirectUri:redirectUrl, contactEmail:clientEmail, description:notes, homepageUrl} = req.body
  if([appName, redirectUrl, clientEmail].some((field) => !field)) {
    return res.status(401).json({message: "All required are necessary"})
  }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.email, clientEmail))
  
  if(client) {
    return res.status(409).json({message: "A Client with same email exists."})
  }
  
  const secret = crypto.randomBytes(64).toString("hex")
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto.createHash("sha256").update(secret + salt).digest("hex");

  const [clientCred] = await db.insert(clientsTable).values({
    appName,
    email:clientEmail,
    redirectUrl,
    secret:hash,
    salt
  }).returning({client_id: clientsTable.id})

  res.status(201).json({message: "Client created successfully.", client_secret: secret, ...clientCred})
})

app.post("/o/authenticate/sign-in", async (req, res) => {
  const { email, password, clientId } = req.body;

  if(!clientId) {
    return res.status(400).json({message: "Client ID is required"})
  }

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || !user.password || !user.salt) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  const hash = crypto
    .createHash("sha256")
    .update(password + user.salt)
    .digest("hex");

  if (hash !== user.password) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }


  const shortCode = crypto.randomBytes(4).toString("hex")
  const ONE_MINUTE_IN_MILLISECOND = 60 * 1000
  
  await db.insert(shortCodeTable).values({
    shortCode,
    expiresAt: new Date(Date.now() + ONE_MINUTE_IN_MILLISECOND),
    clientId,
    userId:user.id
  })

  res.json({ shortCode });
});

app.post("/o/authenticate/sign-up", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  if (!email || !password || !firstName) {
    res
      .status(400)
      .json({ message: "First name, email, and password are required." });
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    res
      .status(409)
      .json({ message: "An account with this email already exists." });
    return;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");

  await db.insert(usersTable).values({
    firstName,
    lastName: lastName ?? null,
    email,
    password: hash,
    salt,
  });

  res.status(201).json({ ok: true });
});

app.use("/o/token", (req, _res, next) => {
  const token = req.headers.authorization
  if(!token || !token.startsWith("Bearer")) {
    next(new Error("Require Bearer Token"))
  }
  const secret = token.split(" ")[1]
  if(!secret) {
    next(new Error("Require Client Secret"))
  }
  // @ts-ignore
  req.secret = secret
  next();
})

app.post("/o/token", async (req,res) => {
  const {shortCode} = req.body

  if(!shortCode) {
    return res.status(400).json({message: "Short code is required"})
  }

  const [shortCodeResult] = await db.delete(shortCodeTable).where(eq(shortCode, shortCodeTable.shortCode)).returning()

  if(!shortCodeResult) return res.status(404).json({message: "Short code not found"})

  if(shortCodeResult.expiresAt < new Date()) {
    return res.status(400).json({message: "Short code is expired"})
  }

  const [[client],[user]] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.id, shortCodeResult.clientId)),
    db.select().from(usersTable).where(eq(usersTable.id, shortCodeResult.userId))
  ])

  // @ts-ignore
  const hash = crypto.createHash("sha256").update(req.secret + client.salt).digest("hex")

  if(hash !== client.secret) {
    return res.status(403).json({message: "Invalid client secret"})
  }

  const ISSUER = `http://localhost:${PORT}`;
  const now = Math.floor(Date.now() / 1000);

  const claims: JWTClaims = {
    iss: ISSUER,
    sub: user.id,
    email: user.email,
    email_verified: String(user.emailVerified),
    exp: now + 3600,
    given_name: user.firstName ?? "",
    family_name: user.lastName ?? undefined,
    name: [user.firstName, user.lastName].filter(Boolean).join(" "),
    picture: user.profileImageURL ?? undefined,
  };

  const token = JWT.sign(claims, PRIVATE_KEY, { algorithm: "RS256" });

  return res.status(200).json({token})
})

app.get("/o/userinfo", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res
      .status(401)
      .json({ message: "Missing or invalid Authorization header." });
    return;
  }

  const token = authHeader.slice(7);

  let claims: JWTClaims;
  try {
    claims = JWT.verify(token, PUBLIC_KEY, {
      algorithms: ["RS256"],
    }) as JWTClaims;
  } catch {
    res.status(401).json({ message: "Invalid or expired token." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claims.sub))
    .limit(1);

  if (!user) {
    res.status(404).json({ message: "User not found." });
    return;
  }

  res.json({
    sub: user.id,
    email: user.email,
    email_verified: user.emailVerified,
    given_name: user.firstName,
    family_name: user.lastName,
    name: [user.firstName, user.lastName].filter(Boolean).join(" "),
    picture: user.profileImageURL,
  });
});

app.listen(PORT, () => {
  console.log(`AuthServer is running on PORT ${PORT}`);
});
