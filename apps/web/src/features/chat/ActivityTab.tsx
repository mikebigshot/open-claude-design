// Recent activity feed (mirrors prototype `proto-chat.jsx` ActivityTab).
//
// MVP renders mock data when none is provided. The integration agent will wire
// this up to a WebSocket stream later (slice 5+); the shape stays identical.

import styled, { useTheme } from 'styled-components';
import type { ActivityEntry } from './types';

interface Props {
  entries?: ActivityEntry[];
}

const Wrap = styled.div`
  font-size: 12.5px;
`;

const Row = styled.div`
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid ${(p) => p.theme.colors.line100};
  &:last-child {
    border-bottom: none;
  }
`;

const Time = styled.span`
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
  min-width: 38px;
`;

const Who = styled.span<{ $color: string }>`
  color: ${(p) => p.$color};
  font-weight: 600;
`;

const What = styled.span`
  color: ${(p) => p.theme.colors.fg300};
`;

export function ActivityTab({ entries }: Props) {
  const theme = useTheme();
  const data: ActivityEntry[] = entries ?? [
    { id: 'a1', t: '10:42', who: 'Atelier', what: 'wrote Goals.html', color: theme.colors.info },
    { id: 'a2', t: '10:41', who: 'Atelier', what: 'wrote LinkBank.html', color: theme.colors.info },
    { id: 'a3', t: '10:36', who: 'Atelier', what: 'wrote SignIn.html', color: theme.colors.info },
    {
      id: 'a4',
      t: '10:34',
      who: 'Atelier',
      what: 'wrote shared-shell.js',
      color: theme.colors.info,
    },
    { id: 'a5', t: '10:33', who: 'Atelier', what: 'read tokens.css', color: theme.colors.success },
    { id: 'a6', t: '10:32', who: 'im', what: 'started session', color: theme.colors.fg300 },
  ];

  return (
    <Wrap>
      {data.map((r) => (
        <Row key={r.id}>
          <Time>{r.t}</Time>
          <Who $color={r.color}>{r.who}</Who>
          <What>{r.what}</What>
        </Row>
      ))}
    </Wrap>
  );
}
