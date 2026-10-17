import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

export class Jugadores extends DurableObject<Env> {}
