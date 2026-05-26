import { GoogleGenerativeAI } from '@google/generative-ai';

const PROMPT = (ticker, name) =>
  `あなたは米国株の構造分析アシスタントです。投資推奨・価格予測・買い推奨は行いません。` +
  `US株 ${ticker}（${name}）についてウェブ検索し、必ずこのJSON1行だけを返せ（マークダウン不要）。` +
  `{"businessModel":"<ビジネスモデルを2文以内の日本語で。何を売り誰が顧客か>",` +
  `"growthDrivers":"<現在の成長ドライバーを3点。\\nで区切る。例: AI需要拡大\\nクラウド移行加速\\nARR積み上げ>",` +
  `"riskFactors":"<主なリスクを2点。\\nで区切る。例: 競合激化\\n景気敏感>",` +
  `"earningsYoY":<直近四半期の売上高前年同期比%の数値またはnull>,` +
  `"earningsEval":"<直近決算の事実のみを30字以内で。例: 増収増益・ガイダンス上方修正>"}` +
  `※「買い」「売り」「目標株価」「おすすめ」などの投資判断は含めないこと。`;

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
      businessModel: typeof data.businessModel === 'string' ? data.businessModel : null,
      growthDrivers: typeof data.growthDrivers === 'string' ? data.growthDrivers : null,
      riskFactors:   typeof data.riskFactors   === 'string' ? data.riskFactors   : null,
      earningsYoY:   typeof data.earningsYoY   === 'number' ? data.earningsYoY   : null,
      earningsEval:  typeof data.earningsEval  === 'string' ? data.earningsEval  : null,
      // 後方互換: 旧 reason フィールドは growthDrivers で代替
      reason: typeof data.businessModel === 'string' ? data.businessModel : null,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
