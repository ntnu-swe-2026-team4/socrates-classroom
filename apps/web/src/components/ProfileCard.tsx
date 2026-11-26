import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ImageUp, Trash2 } from "lucide-react";
import { meQueryOptions } from "@/api/me";
import { Button, Card, Field, Initial, Input, cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";
import {
  AVATARS,
  AVATAR_CLASS,
  PROFILE_NAME_MAX,
  avatarImageFrom,
  saveProfile,
  useProfile,
  type Avatar,
  type Profile,
} from "@/lib/profile";

const AVATAR_LABELS: Record<Avatar, MessageKey> = {
  ink: "profile_avatar_ink",
  ochre: "profile_avatar_ochre",
  moss: "profile_avatar_moss",
  vermilion: "profile_avatar_vermilion",
  graphite: "profile_avatar_graphite",
};

export function ProfileAvatar({ profile, className }: { profile: Profile; className?: string }) {
  if (profile.image) {
    return <img src={profile.image} alt="" className={cn("size-9 shrink-0 rounded-full object-cover", className)} />;
  }
  return <Initial name={profile.name} className={cn(AVATAR_CLASS[profile.avatar], className)} />;
}

export function ProfileCard() {
  const t = useT();
  const me = useQuery(meQueryOptions);
  const profile = useProfile(me.data);
  const picker = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState<Avatar>(profile.avatar);
  const [image, setImage] = useState(profile.image);
  const [saved, setSaved] = useState(false);
  const [imageError, setImageError] = useState(false);
  if (!me.data) return null;
  const userId = me.data.id;
  const trimmed = name.trim();
  const changed = trimmed !== profile.name || avatar !== profile.avatar || image !== profile.image;

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImage(await avatarImageFrom(file));
      setImageError(false);
      setSaved(false);
    } catch {
      setImageError(true);
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-serif text-[17px] font-semibold text-ink">{t("profile_title")}</h3>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("profile_desc")}</p>
      </div>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || !changed) return;
          saveProfile(userId, { name: trimmed, avatar, image });
          setName(trimmed);
          setSaved(true);
        }}
      >
        <div className="flex flex-wrap items-start gap-4">
          <ProfileAvatar profile={{ name: trimmed || profile.name, avatar, image }} className="size-16 text-[26px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={picker}
                type="file"
                accept="image/*"
                hidden
                aria-label={t("profile_avatar_upload")}
                onChange={(event) => {
                  void pickImage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => picker.current?.click()}>
                <ImageUp className="size-4" aria-hidden />
                {t("profile_avatar_upload")}
              </Button>
              {image && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImage(null);
                    setSaved(false);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("profile_avatar_remove")}
                </Button>
              )}
            </div>
            {imageError && (
              <p role="alert" className="text-[13px] text-flag">
                {t("profile_avatar_error")}
              </p>
            )}
            {!image && (
              <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0">
                <legend className="mb-2 p-0 text-xs text-ink-soft">{t("profile_avatar")}</legend>
                <div className="flex flex-wrap gap-2">
                  {AVATARS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-label={t(AVATAR_LABELS[option])}
                      aria-pressed={avatar === option}
                      title={t(AVATAR_LABELS[option])}
                      onClick={() => {
                        setAvatar(option);
                        setSaved(false);
                      }}
                      className={cn(
                        "flex size-9 cursor-pointer items-center justify-center rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ember",
                        AVATAR_CLASS[option],
                        avatar === option && "outline-2 outline-ink",
                      )}
                    >
                      {avatar === option && <Check aria-hidden className="size-4" />}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </div>
        <Field label={t("profile_name")}>
          <Input
            value={name}
            maxLength={PROFILE_NAME_MAX}
            required
            autoComplete="nickname"
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!trimmed || !changed}>
            {t("common_save")}
          </Button>
          {saved && !changed && (
            <span role="status" className="text-[13px] text-ink-soft">
              {t("profile_saved")}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
