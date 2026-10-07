import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/config";
import { AddToSlack, SlackMark } from "@/components/AddToSlack";

const ERRORS: Record<string, string> = {
  not_installed: `Your Slack workspace hasn't installed ${PRODUCT_NAME} yet. Add it to Slack first, then sign in.`,
  oauth: "Sign-in didn't complete. Please try again.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Link href="/" className="mb-12 text-lg font-semibold tracking-tight">{PRODUCT_NAME}</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to your dashboard</h1>
      <p className="muted mt-2">Use the Slack account of a workspace where {PRODUCT_NAME} is installed.</p>
      {error && ERRORS[error] && <p className="mt-6 rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">{ERRORS[error]}</p>}
      <a href="/auth/login" className="btn-primary mt-8 py-3">
        <SlackMark /> Sign in with Slack
      </a>
      {error === "not_installed" && (
        <div className="mt-4 flex justify-center">
          <AddToSlack />
        </div>
      )}
    </main>
  );
}
