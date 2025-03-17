import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CaRegistrar } from "../target/types/ca_registrar";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { assert } from "chai";

describe("ca-registrar", () => {
  // Convert original wallet to authority role
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const authorityWallet = provider.wallet as anchor.Wallet;
  
  // Create buyer wallet
  const buyerKeypair = anchor.web3.Keypair.generate();
  const buyerWallet = new anchor.Wallet(buyerKeypair);
  const buyerProvider = new anchor.AnchorProvider(
    connection,
    buyerWallet,
    { commitment: "confirmed" }
  );
  
  // Create owner wallet
  const ownerKeypair = anchor.web3.Keypair.generate();
  const ownerWallet = new anchor.Wallet(ownerKeypair);
  const ownerProvider = new anchor.AnchorProvider(
    connection,
    ownerWallet,
    { commitment: "confirmed" }
  );
  
  // Configure authority provider as default
  anchor.setProvider(provider);
  
  // Create program instances
  const authorityProgram = anchor.workspace.CaRegistrar as Program<CaRegistrar>;
  const buyerProgram = new anchor.Program(
    authorityProgram.idl,
    buyerProvider,
  ) as Program<CaRegistrar>;
  const ownerProgram = new anchor.Program(
    authorityProgram.idl,
    ownerProvider
  ) as Program<CaRegistrar>;
  
  // Set up Pyth price feed
  const pythSolanaReceiver = new PythSolanaReceiver({ connection, wallet: authorityWallet });
  const SOL_USD_PRICE_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  const solUsdPriceFeedAccount = pythSolanaReceiver.getPriceFeedAccountAddress(0, SOL_USD_PRICE_FEED_ID);
  console.log("solUsdPriceFeedAccount", solUsdPriceFeedAccount);

  // Set up program state PDA
  const PROGRAM_STATE_SEED = Buffer.from("state");
  const [programStateAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [PROGRAM_STATE_SEED],
    authorityProgram.programId
  );
  console.log("Program State PDA:", programStateAccount.toString());

  // Fund new wallets with SOL to pay for transaction fees
  before(async () => {
    // Transfer some SOL to buyer and owner wallets
    await connection.requestAirdrop(
      buyerWallet.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await connection.requestAirdrop(
      ownerWallet.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log("Buyer wallet:", buyerWallet.publicKey.toString());
    console.log("Owner wallet:", ownerWallet.publicKey.toString());
  });

  it("Is initialized by authority", async () => {
    // Configuration values
    const basePriceUsd = new BN(500); // $5.00 (in cents)
    const gracePeriodSeconds = new BN(604800); // 7 days (in seconds)
    
    // Initialize program by authority
    const tx = await authorityProgram.methods
      .initialize(basePriceUsd, gracePeriodSeconds)
      .accounts({
        // @ts-expect-error - Anchor naming convention issue
        programState: programStateAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    
    console.log("Initialize transaction signature:", tx);
  });
  
  it("Buyer can register a domain with specified owner", async () => {
    // Test domain
    const domainName = "testdomain";
    const years = new BN(1);
    
    // Create blockchain address list
    const addresses = [
      {
        chainId: new BN(0), // Solana
        address: ownerWallet.publicKey.toBase58(),
      },
      {
        chainId: new BN(1), // Ethereum
        address: "0x1234567890123456789012345678901234567890",
      }
    ];
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    console.log("Domain Record PDA:", domainRecordAccount.toString());
    
    try {
      // Buyer pays for domain registration, but owner will be the domain owner
      const tx = await buyerProgram.methods
        .registerDomain(
          domainName,
          years,
          addresses,
          ownerWallet.publicKey  // Set owner as owner wallet
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          buyer: buyerWallet.publicKey,
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Domain registration transaction:", tx);
      
      // Fetch and verify domain record
      const domainRecord = await buyerProgram.account.domainRecord.fetch(domainRecordAccount);
      console.log("Domain record:", {
        name: domainRecord.domainName,
        owner: domainRecord.owner.toString(),
        expiryTimestamp: new Date(domainRecord.expiryTimestamp * 1000).toISOString(),
        addresses: domainRecord.addresses,
      });
      
      // Execute assertions to verify results
      assert.equal(domainRecord.domainName, domainName);
      assert.equal(domainRecord.owner.toString(), ownerWallet.publicKey.toString());
      assert.equal(domainRecord.addresses.length, 2);
      assert.equal(domainRecord.addresses[0].chainId, new BN(0));
      assert.equal(domainRecord.addresses[1].chainId, new BN(1));
      assert.equal(domainRecord.addresses[0].address, ownerWallet.publicKey.toBase58());
      assert.equal(domainRecord.addresses[1].address, "0x1234567890123456789012345678901234567890");
    } catch (error) {
      console.error("Error registering domain:", error);
      throw error;
    }
  });

  it("Owner can update domain addresses", async () => {
    // Use previously registered test domain
    const domainName = "testdomain";
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    // Create new blockchain address list
    const updatedAddresses = [
      {
        // @ts-expect-error - Anchor IDL and TypeScript naming inconsistency
        chainId: new BN(0), // Solana
        address: ownerWallet.publicKey.toBase58(),
      },
      {
        // @ts-expect-error - Anchor IDL and TypeScript naming inconsistency
        chainId: new BN(1), // Ethereum
        address: "0x1234567890123456789012345678901234567890",
      },
      {
        // @ts-expect-error - Anchor IDL and TypeScript naming inconsistency
        chainId: new BN(2), // Sui
        address: "0x7890123456789012345678901234567890123456",
      }
    ];
    
    try {
      // Owner updates domain addresses
      const tx = await ownerProgram.methods
        .updateAddresses(
          domainName,
          updatedAddresses
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          owner: ownerWallet.publicKey,
          domainRecord: domainRecordAccount,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Address update transaction:", tx);
      
      // Fetch and verify updated domain record
      const domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      console.log("Domain record:", domainRecord);
      // Execute assertions to verify results
      assert.equal(domainRecord.addresses.length, 3);
      assert.equal(domainRecord.addresses[2].chainId, new BN(2));
      assert.equal(domainRecord.addresses[2].address, "0x7890123456789012345678901234567890123456");
      
      console.log("Domain addresses updated successfully");
      
    } catch (error) {
      console.error("Error updating domain addresses:", error);
      throw error;
    }
  });

  // Error case test
  it("Buyer cannot update domain owned by someone else", async () => {
    const domainName = "testdomain";
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    // Try to update address list using buyer wallet (should fail)
    try {
      await buyerProgram.methods
        .updateAddresses(
          domainName,
          []  // Simple empty address list
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          owner: buyerWallet.publicKey,
          domainRecord: domainRecordAccount,
        })
        .rpc();
      
      // If execution reaches here, test should fail
      assert.fail("Transaction should have failed - buyer is not the owner");
    } catch (error) {
      // Expected error behavior
      console.log("Expected error occurred:", error.message);
      // Verify error message contains "owner" or appropriate error code
      assert.ok(error.message.indexOf("owner") > -1 || error.message.indexOf("0x102") > -1);
    }
  });
});
