// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  ChannelInputSpec,
  ChannelManifest,
  ChannelManifestRegistry,
  MessagingChannelId,
  MessagingStatePath,
  MessagingSerializableValue,
  SandboxMessagingChannelPlan,
  SandboxMessagingHookReferencePlan,
  SandboxMessagingInputReference,
  SandboxMessagingPlan,
} from "../manifest";
import { MessagingHookRegistry, runMessagingHook } from "../hooks";
import type { MessagingHookInputMap, MessagingHookOutputMap } from "../hooks";
import { planAgentRender } from "./engines/agent-render-engine";
import { planBuildSteps } from "./engines/build-step-engine";
import { planCredentialBindings } from "./engines/credential-binding-engine";
import { planHealthChecks } from "./engines/health-check-engine";
import { planNetworkPolicy } from "./engines/policy-resolver";
import { planStateUpdates } from "./engines/state-update-engine";
import type { ManifestCompilerContext } from "./types";

export class ManifestCompiler {
  constructor(
    private readonly registry: ChannelManifestRegistry,
    private readonly hooks = new MessagingHookRegistry(),
  ) {}

  async compile(context: ManifestCompilerContext): Promise<SandboxMessagingPlan> {
    const manifests = this.resolveRequestedManifests(context);
    const channels = [];
    for (const manifest of manifests) {
      channels.push(await this.compileChannel(manifest, context));
    }
    const inputRegistry = new Map(
      channels.map((channel) => [channel.channelId, channel.inputs] as const),
    );
    const activeManifests = manifests.filter((manifest) =>
      isChannelActive(manifest.id, context),
    );

    return {
      schemaVersion: 1,
      sandboxName: context.sandboxName,
      agent: context.agent,
      workflow: context.workflow,
      channels,
      credentialBindings: activeManifests.flatMap((manifest) =>
        planCredentialBindings(manifest, context, inputRegistry.get(manifest.id) ?? []),
      ),
      networkPolicy: planNetworkPolicy(activeManifests, context),
      agentRender: activeManifests.flatMap((manifest) => planAgentRender(manifest, context)),
      buildSteps: activeManifests.flatMap((manifest) => planBuildSteps(manifest)),
      stateUpdates: activeManifests.flatMap((manifest) => planStateUpdates(manifest)),
      healthChecks: activeManifests.flatMap((manifest) => planHealthChecks(manifest)),
    };
  }

  private resolveRequestedManifests(context: ManifestCompilerContext): ChannelManifest[] {
    const requestedIds = new Set([
      ...context.selectedChannels,
      ...(context.configuredChannels ?? []),
    ]);
    const supportedIds =
      context.supportedChannelIds && context.supportedChannelIds.length > 0
        ? new Set(context.supportedChannelIds)
        : null;

    const manifests = this.registry
      .list()
      .filter((manifest) => requestedIds.has(manifest.id))
      .filter((manifest) => manifest.supportedAgents.includes(context.agent))
      .filter((manifest) => !supportedIds || supportedIds.has(manifest.id));

    const foundIds = new Set(manifests.map((manifest) => manifest.id));
    const missingIds = [...requestedIds].filter((channelId) => !foundIds.has(channelId));
    if (missingIds.length > 0) {
      throw new Error(`Missing messaging channel manifest(s): ${missingIds.join(", ")}`);
    }

    return manifests;
  }

  private async compileChannel(
    manifest: ChannelManifest,
    context: ManifestCompilerContext,
  ): Promise<SandboxMessagingChannelPlan> {
    const selected = context.selectedChannels.includes(manifest.id);
    const configured = context.configuredChannels?.includes(manifest.id) ?? false;
    const disabled = context.disabledChannels?.includes(manifest.id) ?? false;
    const active = !disabled && (selected || configured);

    return {
      channelId: manifest.id,
      displayName: manifest.displayName,
      authMode: manifest.auth.mode,
      active,
      selected,
      configured,
      disabled,
      inputs: await resolveChannelInputs(manifest, context, this.hooks, {
        runEnrollment: active && context.workflow === "create" && context.isInteractive,
      }),
      hooks: manifest.hooks.map((hook) => cloneHookReference(manifest.id, hook)),
    };
  }
}

function isChannelActive(
  channelId: MessagingChannelId,
  context: ManifestCompilerContext,
): boolean {
  if (context.disabledChannels?.includes(channelId)) return false;
  return (
    context.selectedChannels.includes(channelId) ||
    (context.configuredChannels ?? []).includes(channelId)
  );
}

function cloneHookReference(
  channelId: MessagingChannelId,
  hook: ChannelManifest["hooks"][number],
): SandboxMessagingHookReferencePlan {
  return {
    channelId,
    id: hook.id,
    phase: hook.phase,
    handler: hook.handler,
    inputs: hook.inputs ? [...hook.inputs] : undefined,
    outputs: hook.outputs?.map((output) => ({ ...output })),
    onFailure: hook.onFailure,
  };
}

async function resolveChannelInputs(
  manifest: ChannelManifest,
  context: ManifestCompilerContext,
  hooks: MessagingHookRegistry,
  options: { readonly runEnrollment: boolean },
): Promise<SandboxMessagingInputReference[]> {
  let inputs = manifest.inputs.map((input) => resolveChannelInput(manifest, input, context));
  const enrollmentHooks = options.runEnrollment
    ? manifest.hooks.filter((hook) => hook.phase === "enroll")
    : [];

  if (enrollmentHooks.length === 0) {
    return applyCredentialAvailability(manifest, inputs, context);
  }

  for (const hook of enrollmentHooks) {
    const result = await runMessagingHook(hook, hooks, {
      channelId: manifest.id,
      inputs: toHookInputMap(inputs),
    });
    inputs = applyCredentialAvailability(
      manifest,
      mergeEnrollmentOutputs(inputs, result.outputs),
      context,
    );
  }

  return inputs;
}

function resolveChannelInput(
  manifest: ChannelManifest,
  input: ChannelInputSpec,
  context: ManifestCompilerContext,
): SandboxMessagingInputReference {
  const base = inputReferenceBase(manifest, input);
  const envValue = readInputEnvValue(input);
  if (envValue !== undefined) {
    return input.kind === "secret"
      ? { ...base, credentialAvailable: true }
      : { ...base, value: envValue };
  }

  return {
    ...base,
  };
}

function inputReferenceBase(
  manifest: ChannelManifest,
  input: ChannelInputSpec,
): Omit<SandboxMessagingInputReference, "credentialAvailable" | "value"> {
  const statePath = readInputStatePath(input);

  return {
    channelId: manifest.id,
    inputId: input.id,
    kind: input.kind,
    required: input.required,
    sourceEnv: input.envKey,
    ...(statePath ? { statePath } : {}),
  };
}

function readInputEnvValue(input: ChannelInputSpec): MessagingSerializableValue | undefined {
  if (!input.envKey) return undefined;
  const value = process.env[input.envKey];
  return value && value.length > 0 ? value : undefined;
}

function readInputStatePath(input: ChannelInputSpec): MessagingStatePath | undefined {
  return input.kind === "config" ? input.statePath : undefined;
}

function isCredentialAvailable(
  manifest: ChannelManifest,
  input: SandboxMessagingInputReference,
  context: ManifestCompilerContext,
): boolean {
  const availability = context.credentialAvailability ?? {};
  const keys = [input.inputId, `${manifest.id}.${input.inputId}`, input.sourceEnv].filter(
    (key): key is string => typeof key === "string" && key.length > 0,
  );

  return keys.some((key) => availability[key] === true);
}

function applyCredentialAvailability(
  manifest: ChannelManifest,
  inputs: readonly SandboxMessagingInputReference[],
  context: ManifestCompilerContext,
): SandboxMessagingInputReference[] {
  return inputs.map((input) => {
    if (input.kind !== "secret") return input;
    return {
      ...input,
      credentialAvailable:
        input.credentialAvailable === true || isCredentialAvailable(manifest, input, context),
    };
  });
}

function toHookInputMap(
  inputs: readonly SandboxMessagingInputReference[],
): MessagingHookInputMap {
  const entries: Array<[string, MessagingSerializableValue]> = [];
  for (const input of inputs) {
    if (input.value === undefined) continue;
    entries.push([input.inputId, input.value]);
    if (input.statePath) entries.push([input.statePath, input.value]);
  }
  return Object.fromEntries(entries);
}

function mergeEnrollmentOutputs(
  inputs: readonly SandboxMessagingInputReference[],
  outputs: MessagingHookOutputMap,
): SandboxMessagingInputReference[] {
  return inputs.map((input) => {
    const output = outputs[input.inputId];
    if (!output) return input;
    if (output.kind === "secret") {
      return { ...input, credentialAvailable: true };
    }
    if (output.kind === "config") {
      return input.value === undefined ? { ...input, value: output.value } : input;
    }
    return input;
  });
}
