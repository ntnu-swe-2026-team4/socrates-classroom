import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Link2, ShieldCheck } from "lucide-react";
import { OAUTH_PROVIDERS, type LoginMethod, type OAuthProvider } from "@socrates/shared";
import { api, ApiError } from "@/api";
import { meQueryOptions } from "@/api/me";
import { authProvidersOptions, identitiesOptions } from "@/api/queries";
import { Button, Card, cn, ConfirmDialog, Field, Input } from "@/components/ui";
import { useFormatDate, useT, type MessageKey, type Translate } from "@/i18n";

const RETURN_TO = "/settings?section=account";

const PROVIDER_LABELS: Record<OAuthProvider, MessageKey> = {
  google: "login_google",
  facebook: "login_facebook",
};

export function providerLabel(t: Translate, provider: string): string {
  const known = OAUTH_PROVIDERS.find((entry) => entry === provider);
  return known === undefined ? provider : t(PROVIDER_LABELS[known]);
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function LoginMethods() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const identities = useQuery(identitiesOptions);
  const providers = useQuery(authProvidersOptions);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [bindEmail, setBindEmail] = useState("");
  const [bindPassword, setBindPassword] = useState("");
  const [bindConfirm, setBindConfirm] = useState("");
  const [confirmUnbind, setConfirmUnbind] = useState<LoginMethod | null>(null);
  const [resent, setResent] = useState(false);

  const data = identities.data;
  const email = data?.email ?? null;
  const oauth = data?.oauth ?? [];
  const reauthActive = data?.reauthExpiresAt != null;
  const methodCount = (email === null ? 0 : 1) + oauth.length;
  const lastVerifiedProvider = email !== null && !email.verified && oauth.length === 1;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: identitiesOptions.queryKey });
    await queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
  };

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy !== null) return;
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught, t("identity_err_generic")));
      if (caught instanceof ApiError && caught.code === "reauth_required") {
        await queryClient.invalidateQueries({ queryKey: identitiesOptions.queryKey });
      }
    } finally {
      setBusy(null);
    }
  };

  const redirectTo = async (start: () => Promise<{ url: string }>) => {
    const { url } = await start();
    window.location.assign(url);
  };

  const reauthWithPassword = () =>
    run("reauth-password", async () => {
      await api.reauthWithPassword(password);
      setPassword("");
      await refresh();
    });

  const reauthWithProvider = (provider: OAuthProvider) =>
    run(`reauth-${provider}`, () => redirectTo(() => api.startOAuthReauth(provider, RETURN_TO)));

  const startBind = (provider: OAuthProvider) =>
    run(`bind-${provider}`, () => redirectTo(() => api.startIdentityBind(provider, RETURN_TO)));

  const submitBindEmail = () =>
    run("bind-email", async () => {
      if (bindPassword !== bindConfirm) {
        setError(t("identity_password_mismatch"));
        return;
      }
      await api.bindEmail({ email: bindEmail.trim(), password: bindPassword });
      setBindEmail("");
      setBindPassword("");
      setBindConfirm("");
      await refresh();
    });

  const submitUnbind = () =>
    run("unbind", async () => {
      if (confirmUnbind === null) return;
      await api.unbindIdentity(confirmUnbind);
      setConfirmUnbind(null);
      await refresh();
    });

  const resendVerification = () =>
    run("resend", async () => {
      await api.resendEmailVerification();
      setResent(true);
    });

  const methodName = (method: LoginMethod): string =>
    method === "email" ? t("identity_email") : t(PROVIDER_LABELS[method]);

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-serif text-[17px] font-semibold text-ink">{t("identity_title")}</h3>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("identity_desc")}</p>
      </div>

      {identities.isPending ? (
        <p className="text-[13px] text-ink-faint">{t("identity_loading")}</p>
      ) : identities.isError ? (
        <p role="alert" className="text-[13px] text-flag">
          {errorText(identities.error, t("identity_err_generic"))}
        </p>
      ) : (
        <>
          <section
            aria-label={t("identity_reauth_title")}
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-3.5",
              reauthActive ? "border-line-strong bg-paper-deep/60" : "border-dashed border-line-strong",
            )}
          >
            <div className="flex items-start gap-2.5">
              <ShieldCheck
                aria-hidden
                className={cn("mt-0.5 size-4 shrink-0", reauthActive ? "text-ember" : "text-ink-faint")}
              />
              <div className="flex flex-col gap-1">
                <p className="text-[13.5px] font-semibold text-ink">{t("identity_reauth_title")}</p>
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  {reauthActive
                    ? t("identity_reauth_until", {
                        time: formatDate(data?.reauthExpiresAt ?? ""),
                      })
                    : t("identity_reauth_desc")}
                </p>
              </div>
            </div>
            {!reauthActive && (
              <div className="flex flex-col gap-2.5">
                {email && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (password.length > 0) void reauthWithPassword();
                    }}
                  >
                    <Field label={t("identity_reauth_password")}>
                      <Input
                        className="min-w-48 flex-1"
                        type="password"
                        autoComplete="current-password"
                        maxLength={128}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Button
                      type="submit"
                      disabled={password.length === 0 || busy !== null}
                      aria-busy={busy === "reauth-password"}
                    >
                      {t("identity_reauth_submit")}
                    </Button>
                  </form>
                )}
                {oauth.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {oauth.map((identity) => (
                      <Button
                        key={identity.provider}
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void reauthWithProvider(identity.provider)}
                      >
                        {t("identity_reauth_sso", { name: t(PROVIDER_LABELS[identity.provider]) })}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <ul className="flex flex-col divide-y divide-line">
            <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper-deep text-ink-soft"
              >
                <Link2 className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] font-semibold text-ink">{t("identity_email")}</span>
                <span className="truncate text-[12.5px] text-ink-soft">
                  {email ? email.email : t("identity_not_linked")}
                </span>
              </div>
              {email && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-[11.5px] text-ink-soft">
                  {email.verified ? (
                    <>
                      <BadgeCheck aria-hidden className="size-3.5 text-ember" />
                      {t("identity_verified")}
                    </>
                  ) : (
                    t("identity_unverified")
                  )}
                </span>
              )}
              {email && !email.verified && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  aria-busy={busy === "resend"}
                  onClick={() => void resendVerification()}
                >
                  {resent ? t("verify_gate_sent") : t("verify_gate_resend")}
                </Button>
              )}
              {email && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null || methodCount === 1 || !reauthActive}
                  onClick={() => setConfirmUnbind("email")}
                >
                  {t("identity_unbind")}
                </Button>
              )}
            </li>
            {OAUTH_PROVIDERS.map((provider) => {
              const identity = oauth.find((entry) => entry.provider === provider);
              const enabled = providers.data?.providers.includes(provider) ?? false;
              return (
                <li key={provider} className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper-deep text-ink-soft"
                  >
                    <span className="size-2 rounded-full bg-current" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13.5px] font-semibold text-ink">{t(PROVIDER_LABELS[provider])}</span>
                    <span className="truncate text-[12.5px] text-ink-soft">
                      {identity
                        ? (identity.email ?? t("identity_linked_at", { date: formatDate(identity.linkedAt) }))
                        : t("identity_not_linked")}
                    </span>
                  </div>
                  {identity ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null || methodCount === 1 || lastVerifiedProvider || !reauthActive}
                      onClick={() => setConfirmUnbind(provider)}
                    >
                      {t("identity_unbind")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || !enabled || !reauthActive}
                      title={enabled ? undefined : t("login_provider_off")}
                      onClick={() => void startBind(provider)}
                    >
                      {t("identity_bind")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {email === null && (
            <form
              aria-label={t("identity_bind_email_title")}
              className="flex flex-col gap-2.5 rounded-lg border border-line-strong bg-paper-deep/60 p-3.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (bindEmail.trim().length > 0 && bindPassword.length >= 8 && busy === null) void submitBindEmail();
              }}
            >
              <div className="flex flex-col gap-1">
                <p className="text-[13.5px] font-semibold text-ink">{t("identity_bind_email_title")}</p>
                <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("identity_bind_email_hint")}</p>
              </div>
              <Field label={t("identity_email_label")}>
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={bindEmail}
                  onChange={(event) => setBindEmail(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2.5">
                <Field label={t("identity_password_label")}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={bindPassword}
                    onChange={(event) => setBindPassword(event.target.value)}
                  />
                </Field>
                <Field label={t("identity_password_confirm")}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={bindConfirm}
                    onChange={(event) => setBindConfirm(event.target.value)}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy !== null || !reauthActive || bindEmail.trim().length === 0 || bindPassword.length < 8}
                  aria-busy={busy === "bind-email"}
                >
                  {t("identity_bind_email_submit")}
                </Button>
                {!reauthActive && <span className="text-[12px] text-ink-faint">{t("identity_reauth_first")}</span>}
              </div>
            </form>
          )}

          {methodCount === 1 && <p className="text-[12px] text-ink-faint">{t("identity_last_method_hint")}</p>}
        </>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-flag">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmUnbind !== null}
        title={t("identity_unbind_confirm_title", { name: confirmUnbind ? methodName(confirmUnbind) : "" })}
        body={t("identity_unbind_confirm_message")}
        confirmLabel={t("identity_unbind")}
        cancelLabel={t("identity_cancel")}
        danger
        onConfirm={() => void submitUnbind()}
        onCancel={() => setConfirmUnbind(null)}
      />
    </Card>
  );
}
