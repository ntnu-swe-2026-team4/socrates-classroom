import { useSyncExternalStore } from "react";

export const AVATARS = ["ink", "ochre", "moss", "vermilion", "graphite"] as const;
export type Avatar = (typeof AVATARS)[number];

export interface Profile {
  name: string;
  avatar: Avatar;
  image: string | null;
}

export const AVATAR_CLASS: Record<Avatar, string> = {
  ink: "bg-ink text-paper",
  ochre: "bg-comic-ochre text-comic-ink",
  moss: "bg-moss text-comic-paper",
  vermilion: "bg-vermilion text-comic-paper",
  graphite: "bg-comic-graphite text-comic-paper",
};

export const PROFILE_NAME_MAX = 80;
export const AVATAR_IMAGE_SIZE = 128;

const IMAGE_PREFIX = "data:image/";
const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function storageKey(userId: string): string {
  return `profile-mock:${userId}`;
}

function readRaw(userId: string): string {
  const key = storageKey(userId);
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
  }
}

function parse(raw: string, fallbackName: string): Profile {
  const base: Profile = { name: fallbackName, avatar: "ink", image: null };
  if (!raw) return base;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return base;
    const name = "name" in stored && typeof stored.name === "string" && stored.name.trim() ? stored.name : base.name;
    const avatar = "avatar" in stored ? AVATARS.find((option) => option === stored.avatar) : undefined;
    const image =
      "image" in stored && typeof stored.image === "string" && stored.image.startsWith(IMAGE_PREFIX)
        ? stored.image
        : null;
    return { name, avatar: avatar ?? base.avatar, image };
  } catch {
    return base;
  }
}

export function saveProfile(userId: string, profile: Profile): void {
  const key = storageKey(userId);
  const raw = JSON.stringify({
    name: profile.name.trim().slice(0, PROFILE_NAME_MAX),
    avatar: profile.avatar,
    image: profile.image,
  });
  memory.delete(key);
  try {
    localStorage.setItem(key, raw);
  } catch {
    memory.set(key, raw);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProfile(user: { id: string; name: string } | null | undefined): Profile {
  const userId = user?.id ?? "";
  const raw = useSyncExternalStore(
    subscribe,
    () => (userId ? readRaw(userId) : ""),
    () => "",
  );
  return parse(raw, user?.name ?? "");
}

export function squareCrop(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}

export async function avatarImageFrom(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_IMAGE_SIZE;
    canvas.height = AVATAR_IMAGE_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    const crop = squareCrop(bitmap.width, bitmap.height);
    context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}
