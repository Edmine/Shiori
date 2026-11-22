import { describe, expect, it } from "bun:test"
import { agent, connect, declaredModels } from "./shiori.agent.js"

describe("shiori.agent.js", () => {
  it("declares valid Magpie agent metadata for Shiori", () => {
    expect(agent.id).toBe("shiori")
    expect(agent.name).toBe("Shiori")
    expect(agent.dir).toBe("~/.shiori")
    expect(agent.config).toBe("~/.shiori/magpie.json")
    expect(agent.format).toBe("json")
    expect(agent.model).toBe("model")
    expect(agent.icon.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("normalizes and deduplicates models with thinking and image flags", () => {
    const list = declaredModels([
      { id: "codex/gpt-6.2-sol", name: "GPT-6.2-Sol · Codex", context: 500000, output: 128000, images: true, efforts: ["low", "high"] },
      { id: "codex/gpt-6.2-sol", name: "Duplicate" },
      { id: "devin/swe-2", context: 262000, efforts: ["none"] },
      null,
      { id: "" },
    ])
    expect(list).toEqual([
      {
        id: "codex/gpt-6.2-sol",
        name: "GPT-6.2-Sol · Codex",
        shortName: "GPT-6.2-Sol · Codex",
        contextWindow: 500000,
        maxTokens: 128000,
        supportsImages: true,
        supportsThinking: true,
      },
      {
        id: "devin/swe-2",
        name: "devin/swe-2",
        shortName: "devin/swe-2",
        contextWindow: 262000,
      },
    ])
  })

  it("writes Shiori bridge payload without overwriting Magpie-managed model key", () => {
    const payload = connect({
      gateway: { v1: "http://127.0.0.1:3425/v1", key: "magpie-shiori" },
      models: [{ id: "devin/claude-opus-5-5", name: "Claude Opus 5.5 · Devin", context: 1000000, images: true }],
    })
    expect(payload).toEqual({
      version: 1,
      agentId: "shiori",
      name: "Magpie",
      baseUrl: "http://127.0.0.1:3425/v1",
      apiKey: "magpie-shiori",
      api: "openai-completions",
      models: [
        {
          id: "devin/claude-opus-5-5",
          name: "Claude Opus 5.5 · Devin",
          shortName: "Claude Opus 5.5 · Devin",
          contextWindow: 1000000,
          supportsImages: true,
        },
      ],
    })
    expect("model" in payload).toBe(false)
  })
})
