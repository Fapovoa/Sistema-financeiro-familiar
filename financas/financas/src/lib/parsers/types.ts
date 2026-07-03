export type ParsedTransaction = {
  transaction_date: string;            // ISO yyyy-mm-dd
  description_original: string;
  description_clean: string;
  amount: number;                      // negativo = saída
  type: "expense" | "income" | "transfer" | "credit_card_payment" | "refund" | "ignored";
  category_suggestion: string | null;
  confidence_score: number;
  is_installment: boolean;
  installment_number: number | null;
  installment_total: number | null;
  is_recurring_candidate: boolean;
  is_card_purchase: boolean;
  invoice_reference_month?: string | null;   // yyyy-mm
  invoice_due_date?: string | null;
  affects_cash_flow: boolean;
  affects_category_report: boolean;
  deduplication_status: "new" | "possible_duplicate" | "reconcile";
  suggested_action: "import" | "ignore" | "audit" | "reconcile";
};

export type ParseResult = {
  detected_type: "bank_statement" | "credit_card_statement";
  detected_institution: string | null;
  invoice?: {
    total_amount: number | null;
    due_date: string | null;
    closing_date: string | null;
    reference_month: string | null;    // yyyy-mm
  };
  transactions: ParsedTransaction[];
  warnings: string[];
};
