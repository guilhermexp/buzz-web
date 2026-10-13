import { AlertTriangle, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { relayHttpOrigin } from "@/shared/config/runtime-config";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

/** Request header the Relay's `/hooks/{id}` endpoint authenticates with. */
const SECRET_HEADER = "X-Webhook-Secret";

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(t("common.copied"));
  } catch {
    toast.error(t("workflows.copyFailed"));
  }
}

/**
 * Owner-only webhook details. The secret exists only in this component's
 * memory after the save that issued it; it is never stored or re-fetched.
 */
export function WorkflowWebhook({
  relayUrl,
  workflowId,
  secret,
  secretLost,
  onSecretDone,
}: {
  relayUrl: string;
  workflowId: string;
  secret: string | null;
  secretLost: boolean;
  onSecretDone: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const url = `${relayHttpOrigin(relayUrl)}/hooks/${workflowId}`;
  return (
    <section aria-labelledby="workflow-webhook-heading" className="grid gap-2">
      <h4 className="text-xs font-semibold text-muted-foreground" id="workflow-webhook-heading">
        {t("workflows.webhook")}
      </h4>
      <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
        <p className="text-[11px] font-medium text-muted-foreground">{t("workflows.webhookUrl")}</p>
        <div className="flex min-w-0 items-center gap-2">
          <code
            className="min-w-0 flex-1 break-all font-mono text-xs"
            data-testid="workflow-webhook-url"
          >
            {url}
          </code>
          <Button size="sm" type="button" variant="outline" onClick={() => void copy(url)}>
            <Copy />
            {t("workflows.copyUrl")}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("workflows.webhookHelp", { example: "{{trigger.<field>}}" })}
        </p>
        {!secret && !secretLost ? (
          <p className="text-[11px] text-muted-foreground">{t("workflows.secretKept")}</p>
        ) : null}
      </div>

      {secret ? (
        <section
          aria-labelledby="workflow-secret-heading"
          className="grid gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2.5"
        >
          <p
            className="flex items-center gap-1.5 text-sm font-semibold"
            id="workflow-secret-heading"
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            {t("workflows.secretTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("workflows.secretOnce")}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{SECRET_HEADER}</p>
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2">
            <code
              className="min-w-0 flex-1 overflow-x-auto font-mono text-xs"
              data-testid="workflow-webhook-secret"
            >
              {revealed ? secret : "•".repeat(24)}
            </code>
            <button
              aria-label={revealed ? t("workflows.secretHide") : t("workflows.secretReveal")}
              className="buzz-icon-button"
              title={revealed ? t("workflows.secretHide") : t("workflows.secretReveal")}
              type="button"
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="button" variant="outline" onClick={() => void copy(secret)}>
              <Copy />
              {t("workflows.copySecret")}
            </Button>
            <Button size="sm" type="button" onClick={onSecretDone}>
              {t("workflows.secretDone")}
            </Button>
          </div>
        </section>
      ) : null}

      {secretLost ? (
        <p
          className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("workflows.secretLost")}
        </p>
      ) : null}
    </section>
  );
}
