import type { NavigationAction, NavigationState, Router } from '@react-navigation/native';

/** Candidate editors are private, single-use screens, not retained stack entries. */
export function candidateEditorRouter<
  State extends NavigationState,
  Action extends NavigationAction,
>(original: Router<State, Action>): Partial<Router<State, Action>> {
  return {
    getStateForAction(state, action, options) {
      const next = original.getStateForAction(state, action, options);
      const current = state.routes[state.index];
      if (!next || next === state || next.stale !== false || current?.name !== 'CandidateManage')
        return next;
      const activeKey = next.routes[next.index]?.key;
      if (activeKey === current.key || !next.routes.some((route) => route.key === current.key)) {
        return next;
      }
      // A normal NAVIGATE keeps the editor underneath its destination and never
      // fires beforeRemove. Remove it so usePreventRemove can ask first, for
      // every departure (header/footer links included), then discard it on leave.
      const routes = next.routes.filter((route) => route.key !== current.key);
      return { ...next, routes, index: routes.findIndex((route) => route.key === activeKey) };
    },
  };
}

export const candidateEditorId = ({ params }: { params: { candidateId: string } }) =>
  params.candidateId;
