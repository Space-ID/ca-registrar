#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;
use crate::instructions::utils::*;

/// Account constraints for updating domain addresses instruction
/// 
/// This instruction allows domain owners to update the list of blockchain addresses associated with the domain.
#[derive(Accounts)]
#[instruction(domain_name: String)]
pub struct UpdateAddressesAccountConstraints<'info> {
    /// Domain owner
    pub owner: Signer<'info>,

    /// Domain record to update
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, domain_name.as_bytes()],
        bump = domain_record.bump,
        has_one = owner @ CaRegistrarError::NotDomainOwner,
    )]
    pub domain_record: Account<'info, DomainRecord>,
}

/// Update blockchain addresses associated with a domain
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `addresses` - New list of blockchain addresses, completely replacing the existing list
/// 
/// # Errors
/// * `NotDomainOwner` - Caller is not the domain owner
/// * `DomainExpired` - Domain has expired
/// * `TooManyAddresses` - Number of addresses exceeds the limit
pub fn update_addresses_handler(
    context: Context<UpdateAddressesAccountConstraints>,
    addresses: Vec<ChainAddress>,
) -> Result<()> {
    // Validate address count
    require!(
        addresses.len() <= 10,
        CaRegistrarError::TooManyAddresses
    );
    
    // Get current timestamp
    let current_timestamp = get_current_timestamp()?;
    
    // Verify domain is not expired
    let domain_record = &mut context.accounts.domain_record;
    require!(
        !domain_record.is_expired(current_timestamp),
        CaRegistrarError::DomainExpired
    );
    
    // Update address list in domain record
    domain_record.addresses = addresses;
    
    msg!("Updated addresses for domain {}", domain_record.domain_name);
    
    Ok(())
} 