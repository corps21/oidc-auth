CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_name" varchar(75) NOT NULL,
	"redirect_url" text NOT NULL,
	"email" varchar(322) NOT NULL,
	"homepage_url" text,
	"notes" text,
	"secret" text NOT NULL,
	"salt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "short_codes" (
	"short_code" varchar,
	"expires_at" timestamp NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "user_id_client_id_short_code_unique" UNIQUE("client_id","short_code","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar(25),
	"last_name" varchar(25),
	"profile_image_url" text,
	"email" varchar(322) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password" varchar(66),
	"salt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "short_codes" ADD CONSTRAINT "short_codes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_codes" ADD CONSTRAINT "short_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;