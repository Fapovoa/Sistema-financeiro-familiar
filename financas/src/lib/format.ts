export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const brDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export const monthLabel = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
