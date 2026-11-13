// Outage simulation and traffic tracing for the MCP toolkit - the editor's
// own analysis engine (src/analysis.js), with results spelled out in labels.

import {
  evaluate, findSinglePointsOfFailure, flowStages, nodeKey, zoneKey, connKey
} from '../../src/analysis.js';
import { diagramAt, resolveEntity, DocError } from './document.js';

const failureKey = (diagram, ref) => {
  const s = String(ref).trim();
  const conn = /^(?:connection|conn):\s*(\S+)$/i.exec(s);
  if (conn) {
    const c = diagram.connections.find(x => String(x.id) === conn[1]);
    if (!c) throw new DocError(`No connection ${conn[1]} in this diagram`);
    return connKey(c.id);
  }
  const hit = resolveEntity(diagram, s);
  return hit.type === 'zone' ? zoneKey(hit.item.id) : nodeKey(hit.item.id);
};

export const analyzeDiagram = (doc, path, { fail = [], singlePointsOfFailure = true } = {}) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const failures = new Set(fail.map(r => failureKey(diagram, r)));
  const result = evaluate(diagram, failures);
  const M = result.model;
  const label = (k) => M.label(k);
  const channelName = (id) => diagram.channels.find(c => c.id === id)?.name ?? `channel ${id}`;

  const channels = diagram.channels.map(ch => {
    const s = result.channels.get(ch.id);
    const flow = result.cur.flows.get(ch.id);
    const out = { channel: ch.name, status: s.status, headline: s.headline };
    if (s.notes?.length) out.notes = s.notes.map(n => n.text);
    if (s.basePairs != null) out.routes = `${s.pairs} of ${s.basePairs} entry → destination routes`;
    if (flow) out.stages = flowStages(flow).map(stage => stage.map(label));
    return out;
  });

  const components = [];
  result.cur.entities.forEach((e, k) => {
    if (e.status === 'healthy') return;
    components.push({
      component: label(k),
      type: k.startsWith('z:') ? 'zone' : 'node',
      status: e.status === 'down' ? 'unavailable' : e.status,
      failedDirectly: failures.has(k),
      reasons: e.reasons
    });
  });

  const out = {
    path: p.join('/'),
    simulatedFailures: [...failures].map(label),
    health: result.cur.counts,
    channels,
    affected: components
  };
  if (diagram.channels.length === 0) {
    out.note = 'This diagram has no channels, so there are no traffic flows to analyse. Add channels and put them on connections (connect / update_connections) to trace flows.';
  }
  if (singlePointsOfFailure) {
    out.singlePointsOfFailure = findSinglePointsOfFailure(result).map(x => ({
      component: x.label,
      type: x.type,
      takesDown: x.channels.map(channelName)
    }));
  }
  return out;
};
