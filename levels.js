/* ChronoVault levels
   ------------------
   #  wall          .  floor          P  player start       E  exit
   a b c  switches — standing on "a" opens every door "A" (same color)
   A B C  doors

   To add a level, copy one of the objects below and draw a new map.
   Keep every switch at least 2 tiles away from its door, otherwise the
   player could hold the door open by themselves without a ghost. */

const LEVELS = [
  {
    id: 'first-echo',
    name: 'First Echo',
    hint: 'Walk onto the gold switch, then press R to rewind. Your ghost will stand on it while you walk through the door.',
    map: [
      '#############',
      '#...........#',
      '#.P.......a.#',
      '#...........#',
      '######A######',
      '#...........#',
      '#.....E.....#',
      '#############',
    ],
  },
  {
    id: 'wait-for-it',
    name: 'Wait For It',
    hint: 'The switch is a long walk away. After rewinding, press Space to wait while your ghost gets there.',
    map: [
      '##############',
      '#E#..........#',
      '#.#.########.#',
      '#.#.#......#.#',
      '#.A.#..a...#.#',
      '###.####.###.#',
      '#P...........#',
      '##############',
    ],
  },
  {
    id: 'relay',
    name: 'Relay',
    hint: 'Two doors, one ghost. A ghost can hold one switch for a while, then walk on to the next.',
    map: [
      '################',
      '#......#.......#',
      '#.P....#...b...#',
      '#......#.......#',
      '#..a...........#',
      '#......#.......#',
      '####A###########',
      '#..............#',
      '###########B####',
      '#.......E......#',
      '################',
    ],
  },
  {
    id: 'wrong-way-round',
    name: 'Wrong Way Round',
    hint: 'Check which door you reach first. Your ghost has to hold the switches in that same order.',
    map: [
      '###############',
      '#P............#',
      '#.###########.#',
      '#.#....#....#.#',
      '#a#.E..A....B.#',
      '#.#....#....#.#',
      '#.###########.#',
      '#......b......#',
      '###############',
    ],
  },
  {
    id: 'the-vault',
    name: 'The Vault',
    hint: 'Three locks. Plan the whole route before you record, and remember that a ghost can wait too.',
    map: [
      '###################',
      '#a.......#....A...#',
      '#........#.######.#',
      '#...P....#.#....#.#',
      '#........C.#.E..B.#',
      '#....c...#.#....#.#',
      '#........#.######.#',
      '#b.......#....A...#',
      '###################',
    ],
  },
];
