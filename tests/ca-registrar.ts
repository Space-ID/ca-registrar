// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CaRegistrar } from "../target/types/ca_registrar";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

describe("ca-registrar", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  
  // Configure the client to use the local cluster.
  anchor.setProvider(provider);

  const program = anchor.workspace.CaRegistrar as Program<CaRegistrar>;
  
  // Set up Pyth price feed
  const pythSolanaReceiver = new PythSolanaReceiver({ connection, wallet });
  const SOL_USD_PRICE_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  const solUsdPriceFeedAccount = pythSolanaReceiver.getPriceFeedAccountAddress(0, SOL_USD_PRICE_FEED_ID);
  console.log("solUsdPriceFeedAccount", solUsdPriceFeedAccount);

  // Set up program state PDA
  const PROGRAM_STATE_SEED = Buffer.from("state");
  const [programStateAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [PROGRAM_STATE_SEED],
    program.programId
  );
  console.log("Program State PDA:", programStateAccount.toString());

  it("Is initialized!", async () => {
    // Configuration values
    const basePriceUsd = new BN(500); // $5.00 in cents
    const gracePeriodSeconds = new BN(604800); // 7 days in seconds
    
    // Initialize the program
    const tx = await program.methods
      .initialize(basePriceUsd, gracePeriodSeconds)
      // @ts-expect-error - Anchor naming convention issue
      .accounts({
        authority: wallet.publicKey,
        programState: programStateAccount,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    
    console.log("Your transaction signature", tx);
  });
  
});
