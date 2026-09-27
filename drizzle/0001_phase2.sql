CREATE TABLE "review_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"shared" boolean DEFAULT false NOT NULL,
	"provider_id" uuid,
	"instructions" text,
	"extra_ignore" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"full_file_context" boolean DEFAULT true NOT NULL,
	"min_severity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "api_version" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "min_severity" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "repo_rules" jsonb;--> statement-breakpoint
ALTER TABLE "review_profiles" ADD CONSTRAINT "review_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_profiles" ADD CONSTRAINT "review_profiles_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_profiles_user_idx" ON "review_profiles" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_profile_id_review_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."review_profiles"("id") ON DELETE set null ON UPDATE no action;