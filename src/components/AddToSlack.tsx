import { PRODUCT_NAME } from "@/lib/config";

export function AddToSlack({ label = "Add to Slack" }: { label?: string }) {
  return (
    <a href="/api/slack/install" className="btn-primary px-5 py-3 text-base" aria-label={`Add ${PRODUCT_NAME} to Slack`}>
      <SlackMark />
      {label}
    </a>
  );
}

export function SlackMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M5.04 15.17a2.53 2.53 0 1 1-2.52-2.53h2.52v2.53Zm1.27 0a2.53 2.53 0 0 1 5.06 0v6.31a2.53 2.53 0 1 1-5.06 0v-6.31ZM8.83 5.04a2.53 2.53 0 1 1 2.54-2.52v2.52H8.83Zm0 1.27a2.53 2.53 0 0 1 0 5.06H2.52a2.53 2.53 0 1 1 0-5.06h6.31Zm10.13 2.52a2.53 2.53 0 1 1 2.52 2.54h-2.52V8.83Zm-1.27 0a2.53 2.53 0 0 1-5.06 0V2.52a2.53 2.53 0 1 1 5.06 0v6.31Zm-2.52 10.13a2.53 2.53 0 1 1-2.54 2.52v-2.52h2.54Zm0-1.27a2.53 2.53 0 0 1 0-5.06h6.31a2.53 2.53 0 1 1 0 5.06h-6.31Z" />
    </svg>
  );
}
