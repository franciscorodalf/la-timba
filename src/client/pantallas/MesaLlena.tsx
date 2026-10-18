import { Link } from "wouter";

const TEXTO = {
  blackjack: (n: number) => `Ya hay ${n} jugadores en el blackjack. Prueba en un rato o echa una carrera mientras tanto.`,
  carrera: (n: number) => `Ya hay ${n} jugadores en la carrera. Prueba en un rato o echa unas manos de blackjack mientras tanto.`,
};

/** La mesa no tiene asiento para ti: lo dice y devuelve a la sala de la partida `codigo`. */
export function MesaLlena({ codigo, juego, jugadores }: { codigo: string; juego: keyof typeof TEXTO; jugadores: number }) {
  return (
    <main className="pantalla pantalla--entrada">
      <h1 className="marca__logo aparece">La Timba</h1>
      <section className="panel aparece" aria-labelledby="mesa-llena">
        <h2 className="panel__titulo" id="mesa-llena">
          La mesa está llena
        </h2>
        <p className="panel__texto">{TEXTO[juego](jugadores)}</p>
        <Link href={`~/p/${codigo}`} className="boton boton--principal boton--ancho">
          Volver a la sala
        </Link>
      </section>
    </main>
  );
}
