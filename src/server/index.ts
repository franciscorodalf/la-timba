import { Jugadores } from "./jugadores";
import { MesaBlackjack } from "./mesa-blackjack";
import { MesaCarrera } from "./mesa-carrera";
import { Partida } from "./partida";

export { Jugadores, MesaBlackjack, MesaCarrera, Partida };

export interface Env {
  Jugadores: DurableObjectNamespace<Jugadores>;
  Partida: DurableObjectNamespace<Partida>;
  MesaBlackjack: DurableObjectNamespace<MesaBlackjack>;
  MesaCarrera: DurableObjectNamespace<MesaCarrera>;
  TOKEN_SECRET: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/salud") return new Response("ok");
    return new Response("No encontrado", { status: 404 });
  },
};
