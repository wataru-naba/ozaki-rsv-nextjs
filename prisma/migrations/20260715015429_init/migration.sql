-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('ADMIN', 'AUTHOR');

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'PUBLIC_HOLIDAY');

-- CreateTable
CREATE TABLE "places" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "admin_role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "weekday" "weekday" NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "open_time" TIME,
    "close_time" TIME,
    "break_start" TIME,
    "break_end" TIME,
    "reservation_limit" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closures" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "start_time" TIME,
    "end_time" TIME,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_slots" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_slots_pkey" PRIMARY KEY ("id"),
    -- docs/design/db-schema.md 5章 / api-design.md 4.5節の推奨に基づき、
    -- count が負値にならないことをDBレベルで保証する(キャンセル時デクリメントの最終防衛ライン)。
    CONSTRAINT "reservation_slots_count_non_negative" CHECK ("count" >= 0)
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "type_id" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "kana" VARCHAR(255),
    "tel" VARCHAR(50),
    "email" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "places_code_key" ON "places"("code");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_place_id_weekday_key" ON "business_hours"("place_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_date_key" ON "public_holidays"("date");

-- CreateIndex
CREATE INDEX "closures_place_id_date_idx" ON "closures"("place_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_slots_place_id_start_at_key" ON "reservation_slots"("place_id", "start_at");

-- CreateIndex
CREATE INDEX "reservations_place_id_start_at_idx" ON "reservations"("place_id", "start_at");

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closures" ADD CONSTRAINT "closures_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_slots" ADD CONSTRAINT "reservation_slots_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
