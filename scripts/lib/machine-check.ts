import type { AnyStateMachine, AnyStateNode } from "xstate";
import { CHECK, FIX, MESSAGE, SPAWN_CHILD, ALWAYS_EVENT } from "./machine-constants";
import { ancestors, closure, descend, isLeaf, machineEdges, statePath, stateNodes, type MachineEdge } from "./machine-graph";

export interface MachineFinding {
  readonly check: string;
  readonly state: string;
  readonly message: string;
  readonly fix: string;
}

const finding = (check: string, node: AnyStateNode, message: string, fix: string): MachineFinding => ({ check, state: statePath(node), message, fix });

function unreachable(nodes: readonly AnyStateNode[], reached: ReadonlySet<AnyStateNode>): MachineFinding[] {
  return nodes
    .filter((node) => !reached.has(node) && (node.parent === undefined || reached.has(node.parent)))
    .map((node) => finding(CHECK.unreachable, node, MESSAGE.unreachable, FIX.unreachable));
}

function deadEnds(
  nodes: readonly AnyStateNode[],
  reached: ReadonlySet<AnyStateNode>,
  homes: readonly AnyStateNode[],
  edges: readonly MachineEdge[],
): MachineFinding[] {
  const returns = (node: AnyStateNode): boolean => {
    const onward = closure([node, ...ancestors(node)], edges);
    return homes.some((home) => onward.has(home)) || [...onward].some((next) => next.type === "final");
  };
  return nodes
    .filter((node) => node.type === "atomic" && reached.has(node) && !returns(node))
    .map((node) => finding(CHECK.deadEnd, node, MESSAGE.deadEnd, FIX.deadEnd));
}

const isSpawn = (action: unknown): boolean => typeof action === "function" && "type" in action && action.type === SPAWN_CHILD;

function resolveAction(machine: AnyStateMachine, action: unknown): unknown {
  const named: Record<string, unknown> = machine.implementations.actions;
  if (typeof action === "string") return named[action];
  if (typeof action === "object" && action !== null && "type" in action && typeof action.type === "string") return named[action.type];
  return action;
}

function startsWork(machine: AnyStateMachine, start: readonly AnyStateNode[], edges: readonly MachineEdge[]): MachineFinding[] {
  const active = closure(start, edges, (edge) => edge.event === ALWAYS_EVENT);
  return [...active].flatMap((node) => [
    ...node.invoke.map((invoke) =>
      finding(CHECK.startsWork, node, `${MESSAGE.invokes} "${typeof invoke.src === "string" ? invoke.src : invoke.id}"`, FIX.startsWork),
    ),
    ...([...node.entry, ...(node.always ?? []).flatMap((transition) => transition.actions)].some((action) => isSpawn(resolveAction(machine, action)))
      ? [finding(CHECK.startsWork, node, MESSAGE.spawns, FIX.startsWork)]
      : []),
  ]);
}

export function checkMachine(machine: AnyStateMachine): MachineFinding[] {
  const edges = machineEdges(machine);
  const nodes = stateNodes(machine).filter((node) => node.type !== "history");
  const start = descend(machine.root);
  const reached = closure(start, edges);
  return [...unreachable(nodes, reached), ...deadEnds(nodes, reached, start.filter(isLeaf), edges), ...startsWork(machine, start, edges)];
}
