//! Constants used throughout the CA-Registrar program.
//!
//! This module defines various constant values used by the program,
//! including PDA seeds, price feed configurations, and time-related constants.
//! These values are essential for consistent behavior across the codebase.

pub const ANCHOR_DISCRIMINATOR: usize = 8;

// PDA Seeds
pub const PROGRAM_STATE_SEED: &[u8] = b"state";
pub const DOMAIN_RECORD_SEED: &[u8] = b"domain";
pub const REVERSE_RECORD_SEED: &[u8] = b"reverse";
pub const PRICE_CONFIG_SEED: &[u8] = b"price_config";


// Pyth price feed IDs
// SOL/USD feed ID - from Pyth network (source: https://pyth.network/price-feeds/crypto-sol-usd)
pub const SOL_USD_PRICE_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// Maximum age of price data
pub const PYTH_PRICE_FEED_MAX_AGE: u64 = 60; // 60 seconds

// Price precision adjustment factor
pub const PRICE_FEED_DECIMALS_ADJUSTMENT: u128 = 10;

// Seconds per year for domain registration
pub const SECONDS_PER_YEAR: i64 = 31_536_000; // 365 * 24 * 60 * 60

