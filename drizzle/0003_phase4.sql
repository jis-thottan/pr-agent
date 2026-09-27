CREATE TABLE "code_host_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"web_url" text,
	"app_id" text,
	"slug" text,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"encrypted_private_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_create_users" boolean DEFAULT true NOT NULL,
	"default_role" text DEFAULT 'reviewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scm_connections" ADD COLUMN "auth_type" text DEFAULT 'pat' NOT NULL;--> statement-breakpoint
ALTER TABLE "scm_connections" ADD COLUMN "app_id" uuid;--> statement-breakpoint
ALTER TABLE "scm_connections" ADD COLUMN "installation_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_id_sso_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_uq" ON "user_identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "scm_connections" ADD CONSTRAINT "scm_connections_app_id_code_host_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."code_host_apps"("id") ON DELETE cascade ON UPDATE no action;