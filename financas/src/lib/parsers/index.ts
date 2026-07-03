import { ParseResult } from "./types";
import { parseItauExtrato } from "./itau-extrato";
import { parseItauFatura } from "./itau-fatura";
import { parseNubankFatura } from "./nubank-fatura";
import { parseInterExtrato } from "./inter-extrato";

/**
 * Detecta a instituição/tipo do PDF pelo conteúdo e delega ao parser certo.
 * A ordem importa: assinaturas mais específicas primeiro, para evitar
 * falsos positivos (ex.: extrato Itaú com "PAG BOLETO NU PAGAMENTOS").
 */
export function parsePdfText(text: string): ParseResult {
  if (/Total desta fatura/i.test(text)) return parseItauFatura(text);
  if (/Banco Inter|Pix enviado:\s*"?Cp/i.test(text)) return parseInterExtrato(text);
  // extratos antes da Nubank: "PAG BOLETO NU PAGAMENTOS" em extratos gera falso positivo
  if (/extrato conta|SALDO DO DIA/i.test(text)) return parseItauExtrato(text);
  if (/Per[íi]odo vigente:|Data de vencimento:/i.test(text)) return parseNubankFatura(text);

  const res = parseItauExtrato(text);
  res.detected_institution = null;
  res.warnings.push("Instituição não reconhecida — parser genérico aplicado. Revise a prévia.");
  return res;
}

export * from "./types";
