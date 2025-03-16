# CA-Registrar

A Solana on-chain program for managing `.ca` domain name registrations, built with Anchor framework.

## Overview

CA-Registrar is a decentralized domain name service that allows users to register, renew, transfer, and manage `.ca` domains on the Solana blockchain. It provides a secure and efficient way to associate domain names with blockchain addresses across multiple chains, enabling cross-chain identity and resolution.

## Features

- **Domain Registration**: Register new `.ca` domains for 1-99 years
- **Multi-chain Addresses**: Associate up to 20 blockchain addresses (Solana, Ethereum, Sui, etc.) with a single domain
- **Domain Renewal**: Extend domain ownership before expiration or during grace period
- **Domain Recovery**: Repurchase expired domains that are beyond grace period
- **Domain Transfer**: Transfer domain ownership to another user
- **Address Management**: Update the list of blockchain addresses associated with domains
- **Dynamic Pricing**: Calculate registration fees using Pyth oracle for SOL/USD price conversion
- **Administrative Controls**: Adjust parameters like base price and grace period

## Architecture

The program consists of several key components:

### State Accounts

- **ProgramState**: A singleton PDA that stores global configuration and statistics
- **DomainRecord**: Stores information about a specific domain, including owner, expiry date, and associated addresses

### Instructions

#### Domain Management
- `register_domain`: Register a new domain name
- `renew_domain`: Renew an existing domain
- `buy_domain`: Purchase an expired domain
- `update_addresses`: Update addresses associated with a domain
- `transfer_domain`: Transfer domain ownership to another user

#### Administrative
- `initialize`: Set up the program with initial configuration
- `update_price`: Adjust the base price for domain registration
- `update_authority`: Transfer admin privileges to a new authority
- `update_grace_period`: Modify the grace period for expired domains
- `withdraw_fees`: Allow admin to withdraw collected fees

## Usage

### Registering a Domain

```typescript
await program.methods
  .registerDomain(
    "mydomain", // Domain name (without .ca suffix)
    1,          // Registration period in years
    addresses,  // Array of blockchain addresses
    ownerKey    // Public key of the domain owner
  )
  .accounts({
    buyer: wallet.publicKey,
    programState: programStatePDA,
    pythPriceUpdate: pythPriceAccount,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
```

### Updating Domain Addresses

```typescript
await program.methods
  .updateAddresses(
    "mydomain", // Domain name
    newAddresses // New array of blockchain addresses
  )
  .accounts({
    owner: wallet.publicKey,
    domainRecord: domainRecordPDA,
  })
  .rpc();
```

### Transferring Domain Ownership

```typescript
await program.methods
  .transferDomain(
    "mydomain",  // Domain name
    newOwnerKey  // Public key of the new owner
  )
  .accounts({
    owner: wallet.publicKey,
    domainRecord: domainRecordPDA,
  })
  .rpc();
```

## Pricing

Domain registration fees are calculated based on:
1. Base price set in USD cents (configurable by admin)
2. Current SOL/USD exchange rate from Pyth oracle
3. Registration period in years

The program automatically converts the USD price to the equivalent amount in SOL at the time of transaction.

## Domain Lifecycle

1. **Available**: Domain has never been registered
2. **Registered**: Domain is owned by a user
3. **Grace Period**: Domain has expired but can still be renewed by the original owner
4. **Expired**: Domain is beyond grace period and can be purchased by any user

