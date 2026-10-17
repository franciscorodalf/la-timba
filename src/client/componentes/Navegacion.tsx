import type { ReactNode } from "react";
import { Link } from "wouter";

export type Seccion = "sala" | "ranking" | "perfil";

interface Props {
  activa: Seccion;
  /** Partida a la que lleva «Sala». Sin ella, «Sala» lleva al inicio. */
  codigo?: string;
}

const trazo = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" {...trazo} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Barra inferior fija con las tres secciones. Los enlaces son absolutos (`~`): valen también desde dentro de una partida. */
export function Navegacion({ activa, codigo }: Props) {
  const secciones: { id: Seccion; etiqueta: string; href: string; icono: ReactNode }[] = [
    {
      id: "sala",
      etiqueta: "Sala",
      href: codigo === undefined ? "~/" : `~/p/${codigo}`,
      icono: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-7v6H4a1 1 0 0 1-1-1z" />,
    },
    {
      id: "ranking",
      etiqueta: "Ranking",
      href: "~/ranking",
      icono: <path d="M4 21v-8h5v8M9.5 21V4h5v17M15 21v-5h5v5" />,
    },
    {
      id: "perfil",
      etiqueta: "Perfil",
      href: "~/perfil",
      icono: (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </>
      ),
    },
  ];

  return (
    <nav className="navegacion" aria-label="Principal">
      <ul>
        {secciones.map(({ id, etiqueta, href, icono }) => (
          <li key={id}>
            <Link href={href} className="navegacion__enlace" aria-current={id === activa ? "page" : undefined}>
              <Icono>{icono}</Icono>
              {etiqueta}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
