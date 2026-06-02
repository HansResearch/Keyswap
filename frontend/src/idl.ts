export const IDL = {
  version: '0.1.0',
  name: 'friendtech_shares',
  instructions: [
    {
      name: 'initializeProtocol',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'config', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'protocolFeePercent', type: 'u64' },
        { name: 'subjectFeePercent', type: 'u64' },
      ],
    },
    {
      name: 'createKey',
      accounts: [
        { name: 'creator', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: true, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'rent', isMut: false, isSigner: false },
      ],
      args: [{ name: 'name', type: 'string' }],
    },
    {
      name: 'setRoyaltyWallet',
      accounts: [
        { name: 'creator', isMut: false, isSigner: true },
        { name: 'subjectState', isMut: true, isSigner: false },
      ],
      args: [
        { name: 'wallet', type: 'publicKey' },
        { name: 'percent', type: 'u64' },
      ],
    },
    {
      name: 'buyShares',
      accounts: [
        { name: 'buyer', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: false, isSigner: false },
        { name: 'subject', isMut: true, isSigner: false },
        { name: 'config', isMut: false, isSigner: false },
        { name: 'feeDestination', isMut: true, isSigner: false },
        { name: 'royaltyWallet', isMut: true, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'buyerAta', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'associatedTokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'sellShares',
      accounts: [
        { name: 'seller', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: false, isSigner: false },
        { name: 'subject', isMut: true, isSigner: false },
        { name: 'config', isMut: false, isSigner: false },
        { name: 'feeDestination', isMut: true, isSigner: false },
        { name: 'royaltyWallet', isMut: true, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'sellerAta', isMut: true, isSigner: false },
        { name: 'cooldownState', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'burnShares',
      accounts: [
        { name: 'holder', isMut: true, isSigner: true },
        { name: 'subjectName', isMut: false, isSigner: false },
        { name: 'subjectState', isMut: true, isSigner: false },
        { name: 'mint', isMut: true, isSigner: false },
        { name: 'holderAta', isMut: true, isSigner: false },
        { name: 'tokenProgram', isMut: false, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'ProtocolConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'feeDestination', type: 'publicKey' },
          { name: 'burnDestination', type: 'publicKey' },
          { name: 'protocolFeePercent', type: 'u64' },
          { name: 'subjectFeePercent', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'SubjectState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'subject', type: 'publicKey' },
          { name: 'supply', type: 'u64' },
          { name: 'priceFloor', type: 'u64' },
          { name: 'name', type: { array: ['u8', 32] } },
          { name: 'hasName', type: 'bool' },
          { name: 'royaltyWallet', type: 'publicKey' },
          { name: 'royaltyPercent', type: 'u64' },
          { name: 'mintBump', type: 'u8' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'SubjectName',
      type: {
        kind: 'struct',
        fields: [
          { name: 'subject', type: 'publicKey' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'CooldownState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'lastSellSlot', type: 'u64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  events: [
    {
      name: 'TradeEvent',
      fields: [
        { name: 'trader', type: 'publicKey', index: false },
        { name: 'subject', type: 'publicKey', index: false },
        { name: 'isBuy', type: 'bool', index: false },
        { name: 'keyAmount', type: 'u64', index: false },
        { name: 'solAmount', type: 'u64', index: false },
        { name: 'protocolFee', type: 'u64', index: false },
        { name: 'subjectFee', type: 'u64', index: false },
        { name: 'royaltyFee', type: 'u64', index: false },
        { name: 'supply', type: 'u64', index: false },
        { name: 'priceFloor', type: 'u64', index: false },
      ],
    },
    {
      name: 'BurnEvent',
      fields: [
        { name: 'burner', type: 'publicKey', index: false },
        { name: 'subject', type: 'publicKey', index: false },
        { name: 'amount', type: 'u64', index: false },
        { name: 'newSupply', type: 'u64', index: false },
      ],
    },
    {
      name: 'NameRegisteredEvent',
      fields: [
        { name: 'subject', type: 'publicKey', index: false },
        { name: 'name', type: 'string', index: false },
      ],
    },
  ],
  errors: [],
} as const
