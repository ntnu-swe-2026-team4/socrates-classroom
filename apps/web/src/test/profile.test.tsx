import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test } from "vitest";
import { meQueryOptions } from "@/api/me";
import { ProfileAvatar, ProfileCard } from "@/components/ProfileCard";
import { setLocale } from "@/i18n";
import { saveProfile, squareCrop, useProfile } from "@/lib/profile";
import type { User } from "@socrates/shared";

const user: User = { id: "u1", name: "Teacher", isAdmin: false, emailVerified: true };
const picture = "data:image/jpeg;base64,AAAA";

function Badge() {
  const profile = useProfile(user);
  return (
    <p data-testid="badge">
      {profile.name}|{profile.avatar}|{profile.image ?? "none"}
    </p>
  );
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryOptions.queryKey, user);
  render(
    <QueryClientProvider client={client}>
      <ProfileCard />
      <Badge />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("the profile starts from the account name with the default avatar", () => {
  mount();
  expect(screen.getByTestId("badge").textContent).toBe("Teacher|ink|none");
  expect(screen.getByLabelText<HTMLInputElement>("Display name").value).toBe("Teacher");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
});

test("saving a new name and colour updates every reader of the profile", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  Ms. Lin  " } });
  fireEvent.click(screen.getByRole("button", { name: "Ochre" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByTestId("badge").textContent).toBe("Ms. Lin|ochre|none");
  expect(screen.getByRole("status").textContent).toBe("Saved");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
});

test("an empty name cannot be saved", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
});

test("a stored picture replaces the colour choices and can be removed", () => {
  saveProfile(user.id, { name: "Teacher", avatar: "moss", image: picture });
  mount();
  expect(screen.queryByRole("button", { name: "Ochre" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
  expect(screen.getByRole("button", { name: "Moss green" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByTestId("badge").textContent).toBe("Teacher|moss|none");
});

test("the avatar shows the picture when there is one and the initial otherwise", () => {
  const { container, rerender } = render(
    <ProfileAvatar profile={{ name: "Teacher", avatar: "ink", image: picture }} />,
  );
  expect(container.querySelector("img")?.getAttribute("src")).toBe(picture);
  rerender(<ProfileAvatar profile={{ name: "Teacher", avatar: "ink", image: null }} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("T");
});

test("stored data that is not a profile falls back to the account", () => {
  localStorage.setItem(
    "profile-mock:u1",
    JSON.stringify({ name: "", avatar: "pink", image: "https://example.com/a.png" }),
  );
  mount();
  expect(screen.getByTestId("badge").textContent).toBe("Teacher|ink|none");
});

test("a picture is cropped to its centred square", () => {
  expect(squareCrop(400, 200)).toEqual({ x: 100, y: 0, side: 200 });
  expect(squareCrop(200, 500)).toEqual({ x: 0, y: 150, side: 200 });
});
