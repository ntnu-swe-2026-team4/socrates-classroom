import * as THREE from "three";
import { expect, test } from "vitest";
import { Avatar, visemeSample } from "@/lib/socrates/avatar";

test("the mouth closes while the voice is silent and opens with its loudness (#482)", () => {
  expect(visemeSample(0.3, 0)).toEqual({ viseme: null, weight: 0 });
  const quiet = visemeSample(0.3, 0.1);
  const loud = visemeSample(0.3, 0.6);
  expect(quiet.viseme).not.toBeNull();
  expect(loud.weight).toBeGreaterThan(quiet.weight);
  expect(loud.weight).toBeLessThanOrEqual(1);
});

test("the head sways while speaking and settles back afterwards (#483)", () => {
  const avatar = new Avatar(new THREE.Group());
  for (let frame = 0; frame < 30; frame += 1) avatar.update(1 / 30);
  expect(avatar.talk).toBe(0);
  avatar.setSpeaking(true);
  for (let frame = 0; frame < 30; frame += 1) avatar.update(1 / 30);
  expect(avatar.talk).toBeGreaterThan(0.9);
  avatar.setSpeaking(false);
  for (let frame = 0; frame < 60; frame += 1) avatar.update(1 / 30);
  expect(avatar.talk).toBeLessThan(0.01);
});
