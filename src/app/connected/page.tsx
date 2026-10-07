import { PRODUCT_NAME } from "@/lib/config";

/** Composio sends users here after they connect an app. */
export default async function Connected({ searchParams }: { searchParams: Promise<{ app?: string; status?: string }> }) {
  const { app, status } = await searchParams;
  const failed = status && status !== "success";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{failed ? "That didn't work" : `${app ?? "App"} connected`}</h1>
      <p className="mt-3 text-neutral-600">
        {failed
          ? "The connection wasn't completed. Ask for a new link and try again."
          : `You can close this tab and go back to Slack. Tell ${PRODUCT_NAME} what you'd like it to do.`}
      </p>
      <a href="slack://open" className="btn-primary mt-8 py-3">Back to Slack</a>
    </main>
  );
}
