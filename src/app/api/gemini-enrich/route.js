import { GoogleGenerativeAI } from '@google/generative-ai';

const PROMPT = (ticker, name) =>
  `US株 ${ticker}（${name}）についてウェブ検索し、必ずこのJSON1行だけを返せ（マークダウン不要）。` +
  `{"reason":"<この銘柄が現在52週高値付近にいる主な理由を3行の日本語で。\\nで改行。各行は簡潔に>",` +
  `"earningsYoY":<直近四半期の売上高前年同期比%の数値またはnull>,` +
  `"earningsEval":"<直近決算の評価を30字以内の日本語で。例: 増収増益・AI需要継続>"}`;

export async function POST(request) {
  try {
    const { ticker, name } = await request.json();
    if (!ticker) return Response.json({ error: 'ticker が必要です' }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return Response.json({ error: 'GEMINI_API_KEY が設定されていません' }, { status: 500 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ googleSearch: {} }],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 400,
      },
    });

    const result = await model.generateContent(PROMPT(ticker, name));
    const text = result.response.text().trim();

    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return Response.json({ error: 'JSON の解析に失敗しました', raw: text.slice(0, 200) }, { status: 500 });

    const data = JSON.parse(match[0]);
    return Response.json({
      reason:       typeof data.reason       === 'string' ? data.reason       : null,
      earningsYoY:  typeof data.earningsYoY  === 'number' ? data.earningsYoY  : null,
      earningsEval: typeof data.earningsEval === 'string' ? data.earningsEval : null,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
