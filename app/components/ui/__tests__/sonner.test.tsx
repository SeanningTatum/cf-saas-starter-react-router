import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { toast as sonnerToast, type ToasterProps } from "sonner";
import enCommon from "@/locales/en/common.json";
import zhCommon from "@/locales/zh/common.json";
import { defaultNS } from "@/lib/constants/i18n";
import { ERROR_TOAST_DURATION_MS, Toaster, toast } from "../sonner";

function renderToaster(lng: "en" | "zh", props: ToasterProps = {}): string {
  const i18n = createInstance();
  i18n.init({
    lng,
    ns: [defaultNS],
    defaultNS,
    initAsync: false,
    showSupportNotice: false,
    resources: {
      en: { common: enCommon },
      zh: { common: zhCommon },
    },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Toaster {...props} />
    </I18nextProvider>,
  );
}

describe("Toaster", () => {
  it("server-renders a polite live region named from common:notifications_region in each locale (catches a mount guard that renders nothing before hydration, dropping containerAriaLabel so sonner's English default shows, or reading the wrong key)", () => {
    expect(enCommon.notifications_region).not.toBe(zhCommon.notifications_region);

    const en = renderToaster("en");
    expect(en).toContain('aria-live="polite"');
    expect(en).toContain(`aria-label="${enCommon.notifications_region} `);
    expect(renderToaster("zh")).toContain(`aria-label="${zhCommon.notifications_region} `);
  });

  it("lets a caller's containerAriaLabel beat the translated default (catches moving {...props} before the primitive's own props)", () => {
    expect(renderToaster("en", { containerAriaLabel: zhCommon.notifications_region })).toContain(
      `aria-label="${zhCommon.notifications_region} `,
    );
  });
});

const lastToast = () => sonnerToast.getHistory().at(-1);

describe("toast", () => {
  it("keeps an error on screen until the user closes it (catches the four-second default that hid errors before they were read)", () => {
    toast.error("Upload failed");
    expect(ERROR_TOAST_DURATION_MS).toBe(Number.POSITIVE_INFINITY);
    expect(lastToast()).toMatchObject({
      title: "Upload failed",
      duration: ERROR_TOAST_DURATION_MS,
    });
  });

  it("lets a caller still set an error's duration, and leaves success toasts on sonner's default", () => {
    toast.error("Brief", { duration: 1 });
    expect(lastToast()).toMatchObject({ title: "Brief", duration: 1 });
    toast.success("Saved");
    expect(lastToast()).not.toHaveProperty("duration");
  });
});
