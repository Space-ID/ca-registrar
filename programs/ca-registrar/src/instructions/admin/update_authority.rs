#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;

/// Account constraints for updating authority instruction
/// 
/// This instruction allows the current program administrator to transfer authority to a new administrator.
#[derive(Accounts)]
pub struct UpdateAuthorityAccountConstraints<'info> {
    /// Current program administrator, must match the authority in ProgramState
    pub authority: Signer<'info>,
    
    /// Program state account
    #[account(
        mut,
        has_one = authority @ CaRegistrarError::NotProgramAuthority,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
    
    /// New program administrator account
    pub new_authority: SystemAccount<'info>,
}

/// Update program administrator
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
pub fn update_authority_handler(
    context: Context<UpdateAuthorityAccountConstraints>,
) -> Result<()> {
    let program_state = &mut context.accounts.program_state;
    let new_authority = context.accounts.new_authority.key();
    
    // Update administrator
    program_state.authority = new_authority;
    
    msg!("Authority updated to: {}", new_authority);
    
    Ok(())
} 