import { ParsedTransaction, ParseResult } from "./types";
import { brDateToISO, cleanDescription, detectInstallment, parseBRL } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// Linha de compra: "28/05 IVAN SOUZA 11/12 164,63"  (dd/mm  estabelecimento  valor)
const TX = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

// Linhas que NÃO são compras (cabeçalhos, totais, boleto, encargos, etc.)
const SKIP = new RegExp([
  "SALDO", "Total d", "Total p", "Pr[óo]xima fatura", "Demais faturas",
  "Limite", "Juros", "IOF", "Multa", "Encargos", "DATA\\s+ESTABELECIMENTO",
  "DATA\\s+PRODUTOS", "DATA\\s+VALOR", "PAGAMENTO", "Pagamento",
  "Lan[çc]amentos", "Repasse", "D[óo]lar de Convers", "FERNANDO",
  "Resumo da fatura", "Titular", "Cart[ãa]o\\b", "Postagem", "Vencimento:",
  "Emiss[ãa]o", "Previs[ãa]o", "recibo do pagador", "Banco Ita[úu]",
  "Nosso N[úu]mero", "Ag[êe]ncia", "Local de Pagamento", "Nome do",
  "Endere[çc]o", "Uso do Banco", "Carteira", "Esp[ée]cie", "Quantidade",
  "Aceite", "Autentica[çc]", "Sacador", "Valor do Documento",
  "Data de Vencimento", "Instru[çc]", "O n[ãa]o pagamento",
  "Preparamos", "Parcelas fixas", "Valor em reais", "Valor total financiado",
  "Total a pagar", "O total da sua fatura", "Com vencimento",
  "Principal \\(", "USD\\b", "BRL\\b",
].join("|"), "i");

/** Fatura Itaú: compras vêm em 2 linhas (dados + categoria/cidade). Lê a 1a, ignora a 2a. */
export function parseItauFatura(text: string): ParseResult {
  const warnings: string[] = [];

  const due = text.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const closing = text.match(/Fechamento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const total = text.match(/Total desta fatura\s+([\d.]+,\d{2})/i);

  const
