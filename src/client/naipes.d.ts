// `@letele/playing-cards` no publica sus tipos (su package.json apunta a un `lib/index.d.ts` que no existe).
// Cada carta es un componente SVG de React de 240 × 336 (5:7), con nombres como `H10`, `Sa`, `Dk`, `Cq`; `B1`/`B2` son
// reversos y `J1`/`J2` comodines.
declare module "@letele/playing-cards" {
  import type { ComponentType, SVGProps } from "react";

  type SvgNaipe = ComponentType<SVGProps<SVGSVGElement> & { title?: string; titleId?: string }>;

  export const B1: SvgNaipe, B2: SvgNaipe, J1: SvgNaipe, J2: SvgNaipe;
  export const Ha: SvgNaipe, H2: SvgNaipe, H3: SvgNaipe, H4: SvgNaipe, H5: SvgNaipe, H6: SvgNaipe, H7: SvgNaipe;
  export const H8: SvgNaipe, H9: SvgNaipe, H10: SvgNaipe, Hj: SvgNaipe, Hq: SvgNaipe, Hk: SvgNaipe;
  export const Da: SvgNaipe, D2: SvgNaipe, D3: SvgNaipe, D4: SvgNaipe, D5: SvgNaipe, D6: SvgNaipe, D7: SvgNaipe;
  export const D8: SvgNaipe, D9: SvgNaipe, D10: SvgNaipe, Dj: SvgNaipe, Dq: SvgNaipe, Dk: SvgNaipe;
  export const Ca: SvgNaipe, C2: SvgNaipe, C3: SvgNaipe, C4: SvgNaipe, C5: SvgNaipe, C6: SvgNaipe, C7: SvgNaipe;
  export const C8: SvgNaipe, C9: SvgNaipe, C10: SvgNaipe, Cj: SvgNaipe, Cq: SvgNaipe, Ck: SvgNaipe;
  export const Sa: SvgNaipe, S2: SvgNaipe, S3: SvgNaipe, S4: SvgNaipe, S5: SvgNaipe, S6: SvgNaipe, S7: SvgNaipe;
  export const S8: SvgNaipe, S9: SvgNaipe, S10: SvgNaipe, Sj: SvgNaipe, Sq: SvgNaipe, Sk: SvgNaipe;
}
