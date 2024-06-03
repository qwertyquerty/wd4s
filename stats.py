import scipy
import numpy as np

def p_a_beats_b(A, B):
    if A[0] is None or A[1] is None or B[0] is None or B[1] is None:
        return None
    
    return 1 - scipy.stats.norm.cdf(0, B[0]-A[0], np.sqrt(A[1]**2 + B[1]**2))

def p_any_beats_all(n):
    return ((1/2)**(n-1)) * n
