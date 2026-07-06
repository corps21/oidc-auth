import {
  uuid,
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),

  firstName: varchar("first_name", { length: 25 }),
  lastName: varchar("last_name", { length: 25 }),

  profileImageURL: text("profile_image_url"),

  email: varchar("email", { length: 322 }).notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),

  password: varchar("password", { length: 66 }),
  salt: text("salt"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

export const clientsTable = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),

  appName: varchar("app_name", {length: 75}).notNull(),
  redirectUrl: text("redirect_url").notNull(),
  email: varchar("email", {length: 322}).notNull(),
  
  homepageUrl: text("homepage_url"),
  notes: text("notes"),
  
  secret: text("secret").notNull(),
  salt: text("salt"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date())
})

export const shortCodeTable = pgTable("short_codes", {
  shortCode: varchar("short_code"),
  expiresAt: timestamp("expires_at").notNull(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id),
  userId: uuid("user_id").notNull().references(() => usersTable.id)
}, (table) => [
  unique("user_id_client_id_short_code_unique").on(table.clientId, table.shortCode, table.userId)
])
