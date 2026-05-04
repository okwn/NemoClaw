// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export type SandboxImageRow = { tag: string; size: string };

export function parseSandboxImageRows(imagesOutput: string): SandboxImageRow[] {
  return imagesOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tag, size] = line.split("\t");
      return { tag, size: size || "unknown" };
    });
}

export function getRegisteredImageTags(
  sandboxes: Array<{ imageTag?: string | null }>,
): Set<string> {
  const registeredTags = new Set<string>();
  for (const sandbox of sandboxes) {
    if (sandbox.imageTag) registeredTags.add(sandbox.imageTag);
  }
  return registeredTags;
}

export function findOrphanedSandboxImages(
  images: SandboxImageRow[],
  sandboxes: Array<{ imageTag?: string | null }>,
): SandboxImageRow[] {
  const registeredTags = getRegisteredImageTags(sandboxes);
  return images.filter((image) => !registeredTags.has(image.tag));
}
