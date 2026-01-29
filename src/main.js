import { simulateDay } from "./engine.js";
import plantilla from "../plantilla.json";

const data = simulateDay(plantilla);

console.table(data);

