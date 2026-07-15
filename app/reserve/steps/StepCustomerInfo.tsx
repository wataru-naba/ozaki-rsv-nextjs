"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CustomerInfoSchema, type CustomerInfoValues } from "../customerSchema";

type Props = {
  defaultValues: Partial<CustomerInfoValues>;
  onBack: () => void;
  onNext: (value: CustomerInfoValues) => void;
};

/**
 * ステップ3: お客様情報入力。React Hook Form + Zod でバリデーションする。
 * ルールは POST スキーマ(lib/reservation/schemas.ts)と整合(要件B章)。
 */
export default function StepCustomerInfo({ defaultValues, onBack, onNext }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerInfoValues>({
    resolver: zodResolver(CustomerInfoSchema),
    defaultValues: {
      name: defaultValues.name ?? "",
      kana: defaultValues.kana ?? "",
      tel: defaultValues.tel ?? "",
      email: defaultValues.email ?? "",
      privacyAgreed: defaultValues.privacyAgreed ?? false,
      hpField: defaultValues.hpField ?? "",
    },
    mode: "onBlur",
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-6" noValidate>
      <h2 className="text-lg font-semibold text-zinc-800">お客様情報をご入力ください</h2>

      <Field label="お名前" required error={errors.name?.message}>
        <input
          type="text"
          autoComplete="name"
          {...register("name")}
          className={inputClass(!!errors.name)}
          placeholder="尾崎 太郎"
        />
      </Field>

      <Field label="フリガナ" required error={errors.kana?.message} hint="ひらがな・カタカナで入力">
        <input
          type="text"
          {...register("kana")}
          className={inputClass(!!errors.kana)}
          placeholder="オザキ タロウ"
        />
      </Field>

      <Field label="電話番号" required error={errors.tel?.message} hint="数字のみ(ハイフンなし)">
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          {...register("tel")}
          className={inputClass(!!errors.tel)}
          placeholder="09012345678"
        />
      </Field>

      <Field label="メールアドレス" required error={errors.email?.message}>
        <input
          type="email"
          autoComplete="email"
          {...register("email")}
          className={inputClass(!!errors.email)}
          placeholder="taro@example.com"
        />
      </Field>

      {/* ハニーポット(api-design.md 8.1節): 画面外に配置し人には見えないが bot には見える。 */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden">
        <label>
          この欄は入力しないでください
          <input type="text" tabIndex={-1} autoComplete="off" {...register("hpField")} />
        </label>
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm text-zinc-700">
          <input type="checkbox" {...register("privacyAgreed")} className="mt-1 h-4 w-4" />
          <span>
            <a
              href="https://www.menicon.co.jp/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 underline"
            >
              プライバシーポリシー
            </a>
            に同意します(必須)
          </span>
        </label>
        {errors.privacyAgreed && (
          <p className="mt-1 text-xs text-red-600">{errors.privacyAgreed.message}</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          戻る
        </button>
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          入力内容の確認へ進む
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-800">
        {label}
        {required && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-600">必須</span>}
        {hint && <span className="text-xs font-normal text-zinc-400">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${
    hasError
      ? "border-red-400 focus:ring-red-300"
      : "border-zinc-300 focus:border-emerald-500 focus:ring-emerald-200"
  }`;
}
