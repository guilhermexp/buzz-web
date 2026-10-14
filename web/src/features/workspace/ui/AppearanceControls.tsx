import {
  CONVERSATION_DENSITIES,
  type DisplayPreferences,
  FONT_SIZES,
  THREAD_LAYOUTS,
  useDisplayPreferences,
} from "@/features/workspace/lib/display-preferences";
import { t } from "@/shared/i18n";

function SegmentedControl<T extends string>({
  legend,
  options,
  value,
  testId,
  onChange,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  testId: string;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset
      className="inline-flex h-8 w-full max-w-72 shrink-0 rounded-md bg-muted/45 p-0.5"
      data-testid={testId}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          className="h-7 min-w-0 flex-1 truncate rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          data-testid={`${testId}-${option.value}`}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** Live sample using the real conversation type and spacing tokens. */
function ReadabilityPreview() {
  const rows = [
    { name: "Maya", time: "9:41", body: [t("workspace.appearance.previewFirst")] },
    {
      name: "Theo",
      time: "9:43",
      body: [t("workspace.appearance.previewSecond"), t("workspace.appearance.previewThird")],
    },
  ];
  return (
    <figure
      aria-label={t("workspace.appearance.preview")}
      className="mt-5 rounded-2xl border bg-background/60 p-2"
    >
      <figcaption className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">
        {t("workspace.appearance.preview")}
      </figcaption>
      {rows.map((row) => (
        <div key={row.name} className="flex gap-2.5 rounded-xl px-2 py-conversation-row">
          <div
            aria-hidden="true"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold"
          >
            {row.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-message font-semibold leading-message-author">{row.name}</span>
              <span className="text-message-timestamp tabular-nums text-muted-foreground/70">
                {row.time}
              </span>
            </div>
            {row.body.map((paragraph, index) => (
              <p
                key={paragraph}
                className={`text-message ${index ? "mt-conversation-paragraph" : "mt-conversation-body"}`}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      ))}
    </figure>
  );
}

/** Font size, conversation density and thread layout, saved for this browser. */
export function ReadabilitySettings() {
  const { preferences, update } = useDisplayPreferences();
  const set =
    <K extends keyof DisplayPreferences>(key: K) =>
    (value: DisplayPreferences[K]) =>
      update({ [key]: value } as Partial<DisplayPreferences>);
  return (
    <section className="mt-8" aria-labelledby="readability-heading">
      <h3 className="text-base font-semibold" id="readability-heading">
        {t("workspace.appearance.readability")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("workspace.appearance.scope")}</p>
      <div className="mt-2 border-t">
        <SettingRow
          description={t("workspace.appearance.fontSizeHint")}
          title={t("workspace.appearance.fontSize")}
        >
          <SegmentedControl
            legend={t("workspace.appearance.fontSize")}
            options={FONT_SIZES.map((value) => ({
              value,
              label: t(`workspace.appearance.fontSize.${value}`),
            }))}
            testId="font-size"
            value={preferences.fontSize}
            onChange={set("fontSize")}
          />
        </SettingRow>
        <SettingRow
          description={t("workspace.appearance.densityHint")}
          title={t("workspace.appearance.density")}
        >
          <SegmentedControl
            legend={t("workspace.appearance.density")}
            options={CONVERSATION_DENSITIES.map((value) => ({
              value,
              label: t(`workspace.appearance.density.${value}`),
            }))}
            testId="conversation-density"
            value={preferences.density}
            onChange={set("density")}
          />
        </SettingRow>
        <SettingRow
          description={
            preferences.threadLayout === "focus"
              ? t("workspace.appearance.threadLayout.focusHint")
              : t("workspace.appearance.threadLayout.splitHint")
          }
          title={t("workspace.appearance.threadLayout")}
        >
          <SegmentedControl
            legend={t("workspace.appearance.threadLayout")}
            options={THREAD_LAYOUTS.map((value) => ({
              value,
              label: t(`workspace.appearance.threadLayout.${value}`),
            }))}
            testId="thread-layout"
            value={preferences.threadLayout}
            onChange={set("threadLayout")}
          />
        </SettingRow>
      </div>
      <ReadabilityPreview />
    </section>
  );
}
