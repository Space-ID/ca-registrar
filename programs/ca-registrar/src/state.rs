//! Program state definitions for CA-Registrar.
//!
//! This module defines the main data structures used by the program to store
//! domain records, blockchain addresses, and global program configuration.
//! Includes functionality for domain lifecycle management like expiration checking.

use anchor_lang::prelude::*;

/// Represents an address on a specific blockchain
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ChainAddress {
    pub chain_id: u8,  // Chain type ID (e.g. 0=Solana, 1=Ethereum, 2=Sui...) TODO: needs a link to the chain id reference
    #[max_len(64)]
    pub address: String,
}

/// Global program state - singleton PDA
#[account]
#[derive(InitSpace)]
pub struct ProgramState {
    /// Admin authority who can update settings and withdraw fees
    pub authority: Pubkey,
    
    /// Base price in USD cents (e.g. 500 = $5.00)
    pub base_price_usd: u64,
    
    /// Total number of domains registered
    pub domains_registered: u64,
    
    /// Grace period duration in seconds
    /// Determines how long a domain can be renewed after expiration
    pub grace_period_seconds: i64,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
}

/// Represents a domain record in the CA system
#[account]
#[derive(InitSpace)]
pub struct DomainRecord {
    /// Domain name without the .ca suffix (e.g., "trump" for "trump.ca")
    #[max_len(253)]
    pub domain_name: String,
    
    /// Owner of the domain
    pub owner: Pubkey,
    
    /// Timestamp when domain expires (seconds since Unix epoch)
    pub expiry_timestamp: i64,
    
    /// Timestamp when domain was initially registered
    pub registration_timestamp: i64,
    
    /// Addresses for different blockchains associated with this domain, max 10
    #[max_len(10)]
    pub addresses: Vec<ChainAddress>,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl DomainRecord {
    /// Calculate if a domain is expired
    pub fn is_expired(&self, current_time: i64) -> bool {
        current_time > self.expiry_timestamp
    }
    
    /// Check if a domain is in grace period
    pub fn is_in_grace_period(&self, current_time: i64, grace_period_seconds: i64) -> bool {
        current_time > self.expiry_timestamp && 
        current_time <= (self.expiry_timestamp + grace_period_seconds)
    }
}
