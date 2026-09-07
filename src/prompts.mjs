const MAX_LIMIT = 50;

function invalidParams(message) {
  return Object.assign(new Error(message), { code: 'invalid_params', jsonRpcCode: -32602 });
}

function requiredId(value, name) {
  if (value === undefined || value === null || value === '') throw invalidParams(`${name} is required`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw invalidParams(`${name} must be a positive integer`);
  return number;
}

const message = (text) => ({ role: 'user', content: { type: 'text', text } });

export const PROMPT_DEFINITIONS = [
  {
    name: 'cycleo_team_review',
    title: 'Review my Cycleo team',
    description: 'Read-only analysis of the authenticated user\'s current roster.',
    arguments: []
  },
  {
    name: 'cycleo_transfer_plan',
    title: 'Plan Cycleo transfers for a race',
    description: 'Draft a TransferAI-guided transfer shortlist for a specific race.',
    arguments: [
      { name: 'raceId', description: 'Numeric Cycleo race id', required: true },
      { name: 'limit', description: `Maximum number of TransferAI suggestions (1-${MAX_LIMIT})`, required: false }
    ]
  },
  {
    name: 'cycleo_race_preview',
    title: 'Preview a Cycleo race',
    description: 'Summarise a race overview and how it affects the user\'s team.',
    arguments: [{ name: 'raceId', description: 'Numeric Cycleo race id', required: true }]
  }
];

export function getPrompt(name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidParams('prompt arguments must be an object');

  switch (name) {
    case 'cycleo_team_review':
      return {
        description: 'Review the current Cycleo roster',
        messages: [message('Call cycleo_get_my_context and cycleo_get_my_team, and cycleo_get_rankings for where my team sits in the league. Review my current roster: highlight underperforming riders, injury risks, my league position and trend, and upcoming races where the team looks weak. This is read-only analysis: do not propose actions that change the team.')]
      };
    case 'cycleo_transfer_plan': {
      const raceId = requiredId(args.raceId, 'raceId');
      const limit = args.limit === undefined || args.limit === '' ? undefined : requiredId(args.limit, 'limit');
      if (limit !== undefined && limit > MAX_LIMIT) throw invalidParams(`limit must be at most ${MAX_LIMIT}`);
      const cap = limit ? ` Request at most ${limit} suggestions.` : '';
      return {
        description: `Plan transfers for race ${raceId}`,
        messages: [message(`Call cycleo_get_my_team for my current roster and cycleo_get_transfer_advice for race ${raceId}.${cap} Compare the TransferAI suggestions against my roster and budget, then propose an ordered transfer shortlist with the reasoning for each pick. Flag when the race has already started or a suggested rider is already owned.`)]
      };
    }
    case 'cycleo_race_preview': {
      const raceId = requiredId(args.raceId, 'raceId');
      return {
        description: `Preview race ${raceId}`,
        messages: [message(`Call cycleo_get_race for race ${raceId} and cycleo_get_my_team. Summarise the race, then explain which of my riders are involved and what to watch. If the race has finished, also call cycleo_get_race_result and cycleo_get_race_classification for race ${raceId} and summarise how my team scored.`)]
      };
    }
    default:
      throw Object.assign(new Error(`Unknown prompt: ${name}`), { code: 'unknown_prompt', jsonRpcCode: -32602 });
  }
}
