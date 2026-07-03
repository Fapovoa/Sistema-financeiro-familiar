import { normalizeDescription } from "@/lib/parsers/normalize";

/** Palavras-chave -> categoria (camada 2 da categorização). */
const KEYWORD_MAP: Array<{ kw: RegExp; category: string; confidence: number }> = [
  { kw: /supermercad|mercado|hortifruti|acougue|sacolao|padaria|armazem|hipermerc|carrefour|bahamas|pao de acucar/, category: "Mercado", confidence: 0.9 },
  { kw: /farmacia|drogaria|laborator|clinica|hospital|unimed|medic|dentist|psicolog|fisioter/, category: "Saúde", confidence: 0.9 },
  { kw: /\buber\b|\b99\b|99app|metro|onibus|estacionament|zul\b|pedagio|taxi|cabify|park/, category: "Transporte", confidence: 0.88 },
  { kw: /posto|gasolina|combust|ipiranga|shell|petrobras|auto posto|autoposto/, category: "Combustível", confidence: 0.85 },
  { kw: /restaurant|ifood|lanchonete|\bbar\b|pizzaria|burguer|burger|hamburg|acai|gelato|sorvete|cafeteria|cafe\b|subway|mcdonald|arcos doura|gourmet/, category: "Comer fora", confidence: 0.85 },
  { kw: /netflix|spotify|amazon prime|prime video|disney|hbo|globoplay|deezer|youtube premium|apple com bill|apple\.com|openai|chatgpt|assinatura|clube top/, category: "Assinaturas", confidence: 0.9 },
  { kw: /escola|curso|faculdade|universidade|colegio|educac|vox2you|voz cursos|kiwify|hotmart|udemy|alura/, category: "Educação", confidence: 0.85 },
  { kw: /cemig|copasa|energia|luz\b|agua\b|internet|claro|vivo|tim\b|oi\b|telefonica|ultragaz|gas\b/, category: "Casa", confidence: 0.88 },
  { kw: /seguro|ipva|iptu|imposto|darf|taxa|tributo|detran/, category: "Impostos", confidence: 0.8 },
  { kw: /iof|juros|tarifa|anuidade|encargo|multa/, category: "Tarifas bancárias", confidence: 0.92 },
  { kw: /renner|riachuelo|c&a|zara|shein|vestuario|calcad|sapataria|lojas/, category: "Vestuário", confidence: 0.75 },
  { kw: /mercadolivre|mercado livre|magalu|magazine|americanas|shopee|amazon(?! prime)|aliexpress|casas bahia/, category: "Compras", confidence: 0.8 },
  { kw: /cinema|teatro|show|ingresso|festival|lazer|clube|parque/, category: "Lazer", confidence: 0.75 },
  { kw: /hotel|pousada|airbnb|booking|passagem|latam|gol\b|azul\b|decolar/, category: "Viagens", confidence: 0.8 },
  { kw: /petshop|pet shop|veterinari|racao/, category: "Pets", confidence: 0.85 },
  { kw: /aluguel|condominio|imobiliaria/, category: "Moradia", confidence: 0.85 },
  { kw: /academia|fitness|smart fit|crossfit/, category: "Saúde", confidence: 0.8 },
  { kw: /salario|pagto salario|pro labore|prolabore/, category: "Salário", confidence: 0.95 },
  { kw: /rend pago|rendiment|dividendo|jcp\b/, category: "Rendimentos", confidence: 0.9 },
];

const TRANSFER_HINTS = /pix transf|ted\b|doc\b|transferencia/;
const CARD_PAYMENT_HINTS = /fatura paga|pagamento de fatura|pag boleto nu pagamentos|pagto cartao|pagamento recebido/;
const REFUND_HINTS = /estorno|dev pix|devolucao|reembolso/;

export type RuleRow = { normalized_pattern: string; category_id: string; confidence: number };

export function classifyType(desc: string, amount: number): {
  type: "expense" | "income" | "transfer" | "credit_card_payment" | "refund";
  confidence: number;
} {
  const n = normalizeDescription(desc);
  if (CARD_PAYMENT_HINTS.test(n)) return { type: "credit_card_payment", confidence: 0.9 };
  if (REFUND_HINTS.test(n)) return { type: "refund", confidence: 0.8 };
  if (TRANSFER_HINTS.test(n)) return { type: "transfer", confidence: 0.6 };
  return amount >= 0
    ? { type: "income", confidence: 0.7 }
    : { type: "expense", confidence: 0.8 };
}

/**
 * Categorização em camadas:
 * 1) regras salvas do usuário (match por inclusão/similaridade do padrão normalizado)
 * 2) palavras-chave conhecidas
 * 3) fallback: null (vai para auditoria se confiança < 0.5)
 */
export function suggestCategory(
  desc: string,
  userRules: RuleRow[] = []
): { category: string | null; category_id: string | null; confidence: number } {
  const n = normalizeDescription(desc);

  for (const r of userRules) {
    if (!r.normalized_pattern) continue;
    if (n.includes(r.normalized_pattern) || r.normalized_pattern.includes(n)) {
      return { category: null, category_id: r.category_id, confidence: Math.max(0.9, r.confidence) };
    }
  }
  for (const { kw, category, confidence } of KEYWORD_MAP) {
    if (kw.test(n)) return { category, category_id: null, confidence };
  }
  return { category: null, category_id: null, confidence: 0.2 };
}

/** Candidatos clássicos a recorrência (assinaturas/serviços mensais). */
export function isRecurringCandidate(desc: string): boolean {
  const n = normalizeDescription(desc);
  return /netflix|spotify|internet|claro|vivo|tim|telefonica|cemig|copasa|ultragaz|escola|unimed|plano de saude|academia|seguro|apple com|openai|clube top|assinatura|consorcio|porto seguro/.test(n);
}
