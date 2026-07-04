export interface AnthropicStatus {
  configured: boolean;
  mode: "placeholder" | "ready";
  note: string;
}

export async function getAnthropicStatus(): Promise<AnthropicStatus> {
  const runtimeInfo = await window.houseRuntime?.getRuntimeInfo();
  const configured = Boolean(runtimeInfo?.anthropicConfigured);

  return {
    configured,
    mode: configured ? "ready" : "placeholder",
    note: configured
      ? "ANTHROPIC_API_KEY is visible to the desktop runtime."
      : "Anthropic calls are stubbed until ANTHROPIC_API_KEY is configured."
  };
}

