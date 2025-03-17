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

  it("Owner can transfer domain to another wallet", async () => {
    // Use previously registered test domain
    const domainName = "testdomain";
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    // Create a new recipient wallet (could be buyer in this case)
    const recipientWallet = buyerWallet; // Reusing buyer wallet as recipient
    
    try {
      // Before transfer, verify current owner
      let domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      console.log("Current domain owner:", domainRecord.owner.toString());
      assert.equal(domainRecord.owner.toString(), ownerWallet.publicKey.toString());
      
      // Transfer domain from owner to recipient
      const tx = await ownerProgram.methods
        .transferDomain(
          domainName,
          recipientWallet.publicKey
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          owner: ownerWallet.publicKey,
          domainRecord: domainRecordAccount,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Domain transfer transaction:", tx);
      
      // Verify the new owner
      domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      console.log("New domain owner:", domainRecord.owner.toString());
      
      // Execute assertions to verify transfer results
      assert.equal(domainRecord.owner.toString(), recipientWallet.publicKey.toString());
      
      console.log("Domain transfer completed successfully");
      
    } catch (error) {
      console.error("Error transferring domain:", error);
      throw error;
    }
  });

  // Test that the previous owner can no longer make changes to the domain
  it("Previous owner cannot update domain after transfer", async () => {
    const domainName = "testdomain";
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    // Try to update address list using previous owner wallet (should fail)
    try {
      await ownerProgram.methods
        .updateAddresses(
          domainName,
          [
            {
              // @ts-expect-error - Anchor IDL and TypeScript naming inconsistency
              chainId: new BN(0),
              address: ownerWallet.publicKey.toBase58(),
            }
          ]
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          owner: ownerWallet.publicKey,
          domainRecord: domainRecordAccount,
        })
        .rpc();
      
      // If execution reaches here, test should fail
      assert.fail("Transaction should have failed - previous owner no longer has control");
    } catch (error) {
      // Expected error behavior
      console.log("Expected error occurred:", error.message);
      // Verify error message contains owner reference
      assert.ok(error.message.indexOf("owner") > -1 || error.message.indexOf("0x102") > -1);
    }
  });

  // Test that the new owner (buyerWallet) can update the domain
  it("New owner can update domain after transfer", async () => {
    const domainName = "testdomain";
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    // Create new blockchain address list
    const newAddresses = [
      {
        // @ts-expect-error - Anchor IDL and TypeScript naming inconsistency
        chainId: new BN(0), // Solana
        address: buyerWallet.publicKey.toBase58(), // Now using buyer's address
      },
      {
        // @ts-expect-error - Anchor IDL and TypeScript naming inconsistency
        chainId: new BN(3), // Some other chain
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
      }
    ];
    
    try {
      // New owner updates domain addresses
      const tx = await buyerProgram.methods
        .updateAddresses(
          domainName,
          newAddresses
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          owner: buyerWallet.publicKey,
          domainRecord: domainRecordAccount,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("New owner's address update transaction:", tx);
      
      // Fetch and verify updated domain record
      const domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      
      // Execute assertions to verify results
      assert.equal(domainRecord.addresses.length, 2);
      assert.equal(domainRecord.addresses[1].chainId, new BN(3));
      assert.equal(domainRecord.addresses[0].address, buyerWallet.publicKey.toBase58());
      
      console.log("New owner updated domain addresses successfully");
      
    } catch (error) {
      console.error("Error updating domain with new owner:", error);
      throw error;
    }
  });

  // Test domain renewal functionality
  it("New owner can renew domain", async () => {
    // Use previously registered and transferred test domain
    const domainName = "testdomain";
    const renewYears = new BN(2); // Renew for 2 more years
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    try {
      // Get current expiry timestamp before renewal
      let domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      const oldExpiryTimestamp = domainRecord.expiryTimestamp;
      console.log("Current expiry timestamp:", new Date(oldExpiryTimestamp * 1000).toISOString());
      
      // Renew the domain
      const tx = await buyerProgram.methods
        .renewDomain(
          domainName,
          renewYears
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          payer: buyerWallet.publicKey,
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Domain renewal transaction:", tx);
      
      // Get updated domain record
      domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      const newExpiryTimestamp = domainRecord.expiryTimestamp;
      console.log("New expiry timestamp:", new Date(newExpiryTimestamp * 1000).toISOString());
      
      // Verify the expiry timestamp was extended
      // Expected extension is renewYears * SECONDS_PER_YEAR (31,536,000 seconds per year)
      const SECONDS_PER_YEAR = 31_536_000; 
      const expectedExtension = renewYears.toNumber() * SECONDS_PER_YEAR;
      
      // The new expiry should be approximately the old expiry + expectedExtension
      // We use approximately because there might be small timing differences
      const actualExtension = newExpiryTimestamp - oldExpiryTimestamp;
      
      console.log("Expected extension (seconds):", expectedExtension);
      console.log("Actual extension (seconds):", actualExtension);
      
      // Assert that the expiry was extended by the correct amount (with small tolerance)
      assert.approximately(actualExtension, expectedExtension, 10); // Allow 10 seconds tolerance
      
      console.log("Domain renewed successfully for", renewYears.toString(), "years");
      
    } catch (error) {
      console.error("Error renewing domain:", error);
      throw error;
    }
  });

  // Test renewal by a non-owner (should still work as renewal doesn't require ownership)
  it("Anyone can renew domain (even non-owner)", async () => {
    // Use the same test domain
    const domainName = "testdomain";
    const renewYears = new BN(1); // Renew for 1 more year
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    try {
      // Get current expiry timestamp before renewal
      let domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      const oldExpiryTimestamp = domainRecord.expiryTimestamp;
      console.log("Current expiry timestamp:", new Date(oldExpiryTimestamp * 1000).toISOString());
      
      // Renew the domain using the previous owner (now non-owner)
      const tx = await ownerProgram.methods
        .renewDomain(
          domainName,
          renewYears
        )
        .accounts({
          // @ts-expect-error - Anchor naming convention issue
          payer: ownerWallet.publicKey, // Previous owner is paying for renewal
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Domain renewal by non-owner transaction:", tx);
      
      // Get updated domain record
      domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      const newExpiryTimestamp = domainRecord.expiryTimestamp;
      console.log("New expiry timestamp:", new Date(newExpiryTimestamp * 1000).toISOString());
      
      // Verify the owner hasn't changed
      assert.equal(domainRecord.owner.toString(), buyerWallet.publicKey.toString(),
        "Owner should not change during renewal");
      
      // Verify the expiry timestamp was extended
      const SECONDS_PER_YEAR = 31_536_000;
      const expectedExtension = renewYears.toNumber() * SECONDS_PER_YEAR;
      const actualExtension = newExpiryTimestamp - oldExpiryTimestamp;
      
      // Assert that the expiry was extended by the correct amount
      assert.approximately(actualExtension, expectedExtension, 10); // Allow 10 seconds tolerance
      
      console.log("Domain renewed successfully by non-owner for", renewYears.toString(), "year");
      
    } catch (error) {
      console.error("Error during non-owner renewal:", error);
      throw error;
    }
  });
});
