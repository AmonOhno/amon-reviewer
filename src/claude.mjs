// Claude API 呼び出し（構造化出力 + ストリーミング + 拒否時のサーバーサイドフォールバック）。
import Anthropic from "@anthropic-ai/sdk";

export class ClaudeClient {
  constructor({ apiKey, model, effort, log = console }) {
    this.client = new Anthropic({ apiKey, maxRetries: 4 });
    this.model = model;
    this.effort = effort;
    this.log = log;
  }

  /**
   * JSON Schema に従った構造化出力を得る。
   * 入力が大きくなり得るのでストリーミングで投げ、finalMessage() で完成形を受け取る。
   * @param {{ system: string, user: Array<object>|string, schema: object, maxTokens?: number, label: string }} p
   */
  async structured({ system, user, schema, maxTokens = 64000, label }) {
    const started = Date.now();
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      // 安全分類器による拒否時は、拒否カテゴリに応じた推奨モデルでサーバー側が再実行する
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort, format: { type: "json_schema", schema } },
      // 固定のシステムプロンプト（観点・スキーマ説明）をキャッシュして繰り返し実行のコストを下げる
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    const message = await stream.finalMessage();
    const u = message.usage || {};
    this.log.info(
      `[claude:${label}] model=${message.model} stop=${message.stop_reason} in=${u.input_tokens} ` +
        `cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens} ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );

    if (message.stop_reason === "refusal") {
      const cat = message.stop_details?.category ?? "unknown";
      throw new Error(`Claude がリクエストを拒否しました（category=${cat}）`);
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(`出力が max_tokens (${maxTokens}) に達して途中で切れました`);
    }
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`構造化出力の JSON 解析に失敗しました: ${text.slice(0, 300)}`);
    }
  }
}
