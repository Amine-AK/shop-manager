const number = new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 2 });

export function money(n: number): string {
  return `${number.format(n)} درهم`;
}
