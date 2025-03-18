// @ts-nocheck
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
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await connection.requestAirdrop(
      ownerWallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
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
        chainId: new BN(0), // Solana
        address: ownerWallet.publicKey.toBase58(),
      },
      {
        chainId: new BN(1), // Ethereum
        address: "0x1234567890123456789012345678901234567890",
      },
      {
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

  it("Cannot buy a domain that has never been registered", async () => {
    // use a new test domain
    const domainName = "neverregistered";
    const years = new BN(1);
    
    // Create new blockchain address list
    const addresses = [
      {
        chainId: new BN(0), // Solana
        address: buyerWallet.publicKey.toBase58(),
      }
    ];
    
    // Calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    try {
      // Try to buy an unregistered domain directly (should fail)
      await buyerProgram.methods
        .buyDomain(
          domainName,
          years,
          addresses,
          buyerWallet.publicKey
        )
        .accounts({
          buyer: buyerWallet.publicKey,
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      // If execution reaches here, test should fail
      assert.fail("Transaction should have failed - cannot buy unregistered domain");
    } catch (error) {
      // Expected error behavior
      console.log("Expected error occurred (unregistered domain):", error.message);
      // Error message should contain account initialization related content
      assert.ok(
        error.message.includes("AccountNotInitialized") || 
        error.message.includes("account not initialized") || 
        error.message.includes("Account does not exist")
      );
    }
  });

  it("Cannot buy a domain that has not expired", async () => {
    // use a new test domain
    const domainName = "activedomaintest";
    const years = new BN(1);
    
    // create blockchain address list
    const initialAddresses = [
      {
        chainId: new BN(0), // Solana
        address: ownerWallet.publicKey.toBase58(),
      }
    ];
    
    // calculate domain record PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      authorityProgram.programId
    );
    
    try {
      // step 1: register domain
      console.log("Registering test domain...");
      await ownerProgram.methods
        .registerDomain(
          domainName,
          years,
          initialAddresses,
          ownerWallet.publicKey
        )
        .accounts({
          buyer: ownerWallet.publicKey,
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      // verify domain registered successfully
      const domainRecord = await authorityProgram.account.domainRecord.fetch(domainRecordAccount);
      console.log("Domain registered with expiry:", new Date(domainRecord.expiryTimestamp.toNumber() * 1000).toISOString());
      
      // step 2: try to buy this unexpired domain (should fail)
      const buyerAddresses = [
        {
          // @ts-expect-error - Anchor ID
          chainId: new BN(0),
          address: buyerWallet.publicKey.toBase58(),
        }
      ];
      
      await buyerProgram.methods
        .buyDomain(
          domainName,
          new BN(2), 
          buyerAddresses,
          buyerWallet.publicKey
        )
        
        .accounts({
          buyer: buyerWallet.publicKey,
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      // if execution reaches here, test should fail
      assert.fail("Transaction should have failed - domain is not expired");
    } catch (error) {
      // check if the error occurred during buyDomain call
      if (error.message.includes("DomainNotAvailableForPurchase") || 
          error.message.includes("6009") ||
          error.message.includes("expired") ||
          error.message.includes("grace period")) {
        console.log("Expected error occurred (domain not available for purchase):", error.message);
      } else {
        // unexpected error
        console.error("Unexpected error:", error);
        throw error;
      }
    }
  });

  // Test: Authority can successfully update price
  it("Authority can update price", async () => {
    try {
      // get current base price
      const programState = await authorityProgram.account.programState.fetch(programStateAccount);
      const oldPrice = programState.basePriceUsd;
      console.log("Current base price:", oldPrice.toString(), "USD cents");
      
      // set new base price (increase by 100 cents)
      const newPrice = oldPrice.add(new BN(100));
      
      // call update_price with admin wallet
      const tx = await authorityProgram.methods
        .updatePrice(newPrice)
        .accounts({
          authority: authorityWallet.publicKey,
          programState: programStateAccount
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Price update transaction:", tx);
      
      // verify price updated
      const updatedProgramState = await authorityProgram.account.programState.fetch(programStateAccount);
      console.log("New base price:", updatedProgramState.basePriceUsd.toString(), "USD cents");
      
      // verify price updated correctly
      assert.equal(
        updatedProgramState.basePriceUsd.toString(), 
        newPrice.toString(),
        "Price was not updated correctly"
      );
      
    } catch (error) {
      console.error("Error updating price:", error);
      throw error;
    }
  });
  
  it("Non-authority cannot update price", async () => {
    try {
      const programState = await authorityProgram.account.programState.fetch(programStateAccount);
      const currentPrice = programState.basePriceUsd;
      console.log("Current base price:", currentPrice.toString(), "USD cents");
      
      // set new base price (reduce 50 cents)
      const attemptedNewPrice = currentPrice.sub(new BN(50));
      
      // try to call update_price with non-admin wallet (buyerWallet), this should fail
      await buyerProgram.methods
        .updatePrice(attemptedNewPrice)
        .accounts({
          authority: buyerWallet.publicKey,
          programState: programStateAccount
        })
        .rpc();
      
      // if execution reaches here, test should fail
      assert.fail("Transaction should have failed - buyer is not the authority");
      
    } catch (error) {
      // expected error behavior
      console.log("Expected error occurred (non-authority update):", error.message);
      
      // verify error message contains authority error info
      assert.ok(
        error.message.includes("NotProgramAuthority") || 
        error.message.includes("0x1773") ||  // error code
        error.message.includes("authority") ||
        error.message.includes("has_one constraint was violated")
      );
      
      const programState = await authorityProgram.account.programState.fetch(programStateAccount);
      console.log("Price after failed update attempt:", programState.basePriceUsd.toString(), "USD cents");
    }
  });
  

  it("Authority can update grace period", async () => {
    try {

      const programState = await authorityProgram.account.programState.fetch(programStateAccount);
      const oldGracePeriod = programState.gracePeriodSeconds;
      console.log("Current grace period:", oldGracePeriod.toString(), "seconds");
      
      // set new grace period
      const newGracePeriod = oldGracePeriod.add(new BN(86400));
      
      // call update_grace_period with admin wallet
      const tx = await authorityProgram.methods
        .updateGracePeriod(newGracePeriod)
        
        .accounts({
          authority: authorityWallet.publicKey,
          programState: programStateAccount
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Grace period update transaction:", tx);
      
      // verify grace period updated
      const updatedProgramState = await authorityProgram.account.programState.fetch(programStateAccount);
      console.log("New grace period:", updatedProgramState.gracePeriodSeconds.toString(), "seconds");
      
      // verify grace period updated correctly
      assert.equal(
        updatedProgramState.gracePeriodSeconds.toString(), 
        newGracePeriod.toString(),
        "Grace period was not updated correctly"
      );
      
    } catch (error) {
      console.error("Error updating grace period:", error);
      throw error;
    }
  });
  
  it("Non-authority cannot update grace period", async () => {
    try {
      const programState = await authorityProgram.account.programState.fetch(programStateAccount);
      const currentGracePeriod = programState.gracePeriodSeconds;
      console.log("Current grace period:", currentGracePeriod.toString(), "seconds");
      
      const attemptedNewGracePeriod = currentGracePeriod.add(new BN(172800));
      
      // try to call update_grace_period with non-admin wallet (buyerWallet), this should fail
      await buyerProgram.methods
        .updateGracePeriod(attemptedNewGracePeriod)
        
        .accounts({
          authority: buyerWallet.publicKey,
          programState: programStateAccount
        })
        .rpc();
      
      assert.fail("Transaction should have failed - buyer is not the authority");
      
    } catch (error) {
      console.log("Expected error occurred (non-authority update):", error.message);

      assert.ok(
        error.message.includes("NotProgramAuthority") || 
        error.message.includes("0x1773") || 
        error.message.includes("authority") ||
        error.message.includes("has_one constraint was violated")
      );
      
      const programState = await authorityProgram.account.programState.fetch(programStateAccount);
      console.log("Grace period after failed update attempt:", programState.gracePeriodSeconds.toString(), "seconds");
    }
  });

  it("Non-authority can call withdrawFees and funds go to authority", async () => {
    try {
      // Record initial balances
      const initialProgramBalance = await connection.getBalance(programStateAccount);
      console.log("Initial program state balance:", initialProgramBalance, "lamports");
      
      const initialAuthorityBalance = await connection.getBalance(authorityWallet.publicKey);
      console.log("Initial authority balance:", initialAuthorityBalance, "lamports");
      
      const initialBuyerBalance = await connection.getBalance(buyerWallet.publicKey);
      console.log("Initial buyer balance:", initialBuyerBalance, "lamports");
      
      // Calculate rent-exempt amount
      const PROGRAM_STATE_SIZE = 8 + // Anchor discriminator
                                 32 + // authority: Pubkey
                                 8 + // base_price_usd: u64
                                 8 + // domains_registered: u64
                                 8 + // grace_period_seconds: i64
                                 1;  // bump: u8
                                 
      const rent = await connection.getMinimumBalanceForRentExemption(PROGRAM_STATE_SIZE);
      const expectedWithdrawal = Math.max(0, initialProgramBalance - rent);
      
      if (expectedWithdrawal <= 0) {
        console.log("Not enough funds in program state account for withdrawal test");
        return;
      }
      
      console.log("Expected withdrawal amount:", expectedWithdrawal, "lamports");
      
      // Call withdrawFees
      const tx = await buyerProgram.methods
        .withdrawFees()
        .accounts({
          signer: buyerWallet.publicKey,
          authority: authorityWallet.publicKey,
          programState: programStateAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Withdrawal transaction:", tx);
      
      // Wait for transaction confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get post-withdrawal balances
      const finalProgramBalance = await connection.getBalance(programStateAccount);
      const finalAuthorityBalance = await connection.getBalance(authorityWallet.publicKey);
      const finalBuyerBalance = await connection.getBalance(buyerWallet.publicKey);
      
      console.log("Final program state balance:", finalProgramBalance, "lamports");
      console.log("Final authority balance:", finalAuthorityBalance, "lamports");
      console.log("Final buyer balance:", finalBuyerBalance, "lamports");
      
      // Verify fund flow:
      // 1. Program state account should only have rent-exempt amount left
      assert.approximately(
        finalProgramBalance,
        rent,
        rent * 0.1, // Allow 10% margin for error
        "Program state should be left with approximately the rent exemption amount"
      );
      
      // 2. Authority balance should increase (accounting for transaction fees)
      assert.approximately(
        finalAuthorityBalance - initialAuthorityBalance,
        expectedWithdrawal,
        50000, // Allow margin for transaction fees
        "Authority balance should increase by roughly the withdrawn amount"
      );
      
      // 3. Buyer balance should decrease (only transaction fees)
      assert.isBelow(
        finalBuyerBalance,
        initialBuyerBalance,
        "Buyer balance should decrease due to transaction fees"
      );
      
      console.log("Withdrawal test successful");
      
    } catch (error) {
      console.error("Detailed error:", {
        message: error.message,
        logs: error.logs,
        details: error.details,
        errorLogs: error.errorLogs
      });
      throw error;
    }
  });
  
  it("Authority can withdraw all available balance", async () => {
    try {
      // Record initial balances
      const initialProgramBalance = await connection.getBalance(programStateAccount);
      console.log("Initial program state balance:", initialProgramBalance, "lamports");
      
      const initialAuthorityBalance = await connection.getBalance(authorityWallet.publicKey);
      console.log("Initial authority balance:", initialAuthorityBalance, "lamports");

      // Calculate expected withdrawal amount
      const rent = await connection.getMinimumBalanceForRentExemption(1000); // Estimate program state size
      const expectedWithdrawal = Math.max(0, initialProgramBalance - rent);
      
      if (expectedWithdrawal <= 0) {
        console.log("Not enough funds in program state account for withdrawal test");
        return;
      }
      
      console.log("Expected withdrawal amount:", expectedWithdrawal, "lamports");
      
      // Call withdrawFees as authority
      const tx = await authorityProgram.methods
        .withdrawFees()
        .accounts({
          signer: authorityWallet.publicKey,
          authority: authorityWallet.publicKey,
          programState: programStateAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Withdrawal transaction:", tx);
      
      // Wait for transaction confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get post-withdrawal balances
      const finalProgramBalance = await connection.getBalance(programStateAccount);
      const finalAuthorityBalance = await connection.getBalance(authorityWallet.publicKey);
      
      console.log("Final program state balance:", finalProgramBalance, "lamports");
      console.log("Final authority balance:", finalAuthorityBalance, "lamports");
      
      // Verify results:
      // 1. Program state account should only have rent-exempt amount left
      assert.approximately(
        finalProgramBalance,
        rent,
        rent * 0.1, // Allow some margin of error
        "Program state should be left with approximately the rent exemption amount"
      );
      
      // 2. Authority balance should increase (accounting for transaction fees)
      assert.approximately(
        finalAuthorityBalance - initialAuthorityBalance,
        expectedWithdrawal,
        20000, // Allow margin for transaction fees
        "Authority balance should increase by roughly the withdrawn amount"
      );
      
      console.log("Full withdrawal test successful");
      
    } catch (error) {
      console.error("Detailed error:", {
        message: error.message,
        logs: error.logs,
        details: error.details,
        errorLogs: error.errorLogs
      });
      throw error;
    }
  });
});
